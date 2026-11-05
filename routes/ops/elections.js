// Executive committee elections (কার্যনির্বাহী কমিটি নির্বাচন) with secret ballots and ballot symbols.
//
// Flow: DRAFT (set posts, register candidates with a symbol) → OPEN (owners vote in the portal, or at a
// polling booth run by staff, between the opening and closing times) → CLOSED (count; settle ties by lot)
// → PUBLISHED (owners see the result; the winners can be installed as the managing committee).
// A post with no more candidates than seats is uncontested: those candidates are elected unopposed
// (বিনা প্রতিদ্বন্দ্বিতায়) and the post is left off the ballot.
//
// Secrecy: election_voters records who voted; ballots have a random id, a date only, and no voter link
// (see migrations/021). Tallies are hidden from everyone until voting is closed.
// /portal/* are the only routes flat-owner logins may reach (see app.js).
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { db, fail, bad, userName, ymd, today, pick } = require('./common');
const { getSettings } = require('../../utils/org');
const { SYMBOL_KEYS } = require('../../utils/electionSymbols');
const sms = require('../../utils/sms');
const { members, POSITIONS } = require('./association');

const STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'CANCELLED'];
const BOOTH_TOKEN_MS = 10 * 60 * 1000;

// Within OPEN, whether voting is actually possible right now.
function phase(e, now = new Date()) {
  if (e.status !== 'OPEN') return e.status;
  if (now < new Date(e.voting_opens_at)) return 'NOT_YET';
  if (now > new Date(e.voting_closes_at)) return 'ENDED';
  return 'VOTING';
}

async function getElection(id, conn = db) {
  const e = await conn('elections').where({ id_elections: id }).first();
  if (!e) throw Object.assign(new Error('Election not found'), { status: 404 });
  return e;
}

// Posts with their candidates (name, flats, symbol) and whether each post is contested.
async function ballotData(id) {
  const [positions, candidates, mem] = await Promise.all([
    db('election_positions').where({ id_elections: id }).orderBy('sort_order').orderBy('id_positions'),
    db('election_candidates as c').join('owners as o', 'o.id_owners', 'c.id_owners').where('c.id_elections', id).where('c.status', 'APPROVED')
      .orderBy('c.id_candidates').select('c.*', 'o.full_name'),
    members(),
  ]);
  const flats = new Map(mem.map(m => [m.id_owners, m.flats]));
  return positions.map(p => {
    const list = candidates.filter(c => c.id_positions === p.id_positions)
      .map(c => ({ id_candidates: c.id_candidates, id_owners: c.id_owners, full_name: c.full_name, flats: flats.get(c.id_owners) || '', symbol_key: c.symbol_key, manifesto: c.manifesto, won_by_lot: !!c.won_by_lot }));
    return { ...p, candidates: list, contested: list.length > p.seats };
  });
}

// Weighted tally per post: votes per candidate, ballots that skipped the post, winners and ties.
async function results(e) {
  const positions = await ballotData(e.id_elections);
  const [votes, [{ ballots, weight }], answered] = await Promise.all([
    db('election_ballot_choices as c').join('election_ballots as b', 'b.id_ballots', 'c.id_ballots').where('b.id_elections', e.id_elections)
      .groupBy('c.id_candidates').select('c.id_candidates').sum({ votes: 'b.weight' }),
    db('election_ballots').where({ id_elections: e.id_elections }).count({ ballots: '*' }).sum({ weight: 'weight' }),
    db.from(db('election_ballot_choices as c').join('election_ballots as b', 'b.id_ballots', 'c.id_ballots').where('b.id_elections', e.id_elections)
      .distinct('c.id_ballots', 'c.id_positions', 'b.weight').as('x')).groupBy('x.id_positions').select('x.id_positions').sum({ w: 'x.weight' }),
  ]);
  const byCand = new Map(votes.map(v => [v.id_candidates, Number(v.votes)]));
  const byPos = new Map(answered.map(a => [a.id_positions, Number(a.w)]));
  const totalWeight = Number(weight) || 0;
  const out = positions.map(p => {
    const list = p.candidates.map(c => ({ ...c, votes: p.contested ? byCand.get(c.id_candidates) || 0 : null })).sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
    if (!p.contested) return { ...p, candidates: list.map(c => ({ ...c, elected: true, unopposed: true })), tie: null, skipped: null };
    const cut = list[p.seats - 1]?.votes ?? 0;
    // Everyone above the cut-off is in; candidates exactly at the cut-off share the remaining seats.
    const above = list.filter(c => c.votes > cut);
    const atCut = list.filter(c => c.votes === cut && cut > 0);
    const left = p.seats - above.length;
    const lot = atCut.filter(c => c.won_by_lot);
    const tieOpen = atCut.length > left && lot.length !== left;
    const elected = new Set([...above, ...(atCut.length <= left ? atCut : lot)].map(c => c.id_candidates));
    return { ...p, candidates: list.map(c => ({ ...c, elected: !tieOpen || c.votes > cut ? elected.has(c.id_candidates) : false, tied: tieOpen && c.votes === cut && cut > 0 })),
      tie: atCut.length > left ? { seats_left: left, candidates: atCut.map(c => c.id_candidates), settled: !tieOpen } : null,
      skipped: totalWeight - (byPos.get(p.id_positions) || 0) };
  });
  return { positions: out, ballots: Number(ballots) || 0, total_weight: totalWeight, unresolved_ties: out.some(p => p.tie && !p.tie.settled) };
}

const turnout = async e => {
  const [mem, [{ n }]] = await Promise.all([members(), db('election_voters').where({ id_elections: e.id_elections }).count({ n: '*' })]);
  return { eligible: mem.length, voted: Number(n) };
};

// Numeric ids only, so /portal… falls through to the owner routes below.
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next('route')));

// ── Staff: setup ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await db('elections as e').leftJoin('association_meetings as m', 'm.id_meetings', 'e.id_meetings').orderBy('e.voting_opens_at', 'desc')
      .select('e.*', 'm.title as meeting_title');
    const voted = Object.fromEntries((await db('election_voters').groupBy('id_elections').select('id_elections').count({ n: '*' })).map(r => [r.id_elections, Number(r.n)]));
    const eligible = (await members()).length;
    res.json({ success: true, eligible, symbols: SYMBOL_KEYS, positions: POSITIONS,
      rows: rows.map(e => ({ ...e, phase: phase(e), voted: voted[e.id_elections] || 0 })),
      meetings: await db('association_meetings').whereIn('meeting_type', ['AGM', 'EGM']).orderBy('meeting_at', 'desc').select('id_meetings', 'title', 'meeting_at') });
  } catch (err) { fail(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const row = pick(b, ['title', 'id_meetings', 'voting_opens_at', 'voting_closes_at', 'term_start', 'term_end', 'vote_basis', 'rules_note']);
    if (!row.title || !String(row.title).trim()) throw bad('Election title is required');
    const opens = new Date(row.voting_opens_at); const closes = new Date(row.voting_closes_at);
    if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) throw bad('Set when voting opens and closes');
    if (closes <= opens) throw bad('Voting must close after it opens');
    row.voting_opens_at = opens; row.voting_closes_at = closes;
    row.term_start = ymd(row.term_start);
    if (!row.term_start) throw bad('Set the date the new committee takes office');
    row.term_end = ymd(row.term_end) || null;
    if (row.term_end && row.term_end <= row.term_start) throw bad('Term end must be after term start');
    row.vote_basis = row.vote_basis === 'PER_FLAT' ? 'PER_FLAT' : 'PER_OWNER';
    if (b.is_secret !== undefined) row.is_secret = !!b.is_secret;
    if (b.id_elections) {
      const e = await getElection(b.id_elections);
      if (e.status !== 'DRAFT') {
        // Once voting has started only the closing time (extension) and notes may change.
        if (['OPEN'].includes(e.status) && closes > new Date()) {
          await db('elections').where({ id_elections: e.id_elections }).update({ voting_closes_at: closes, rules_note: row.rules_note ?? e.rules_note });
          return res.json({ success: true, message: 'Closing time updated' });
        }
        throw bad('This election has started — its settings can no longer be changed');
      }
      await db('elections').where({ id_elections: e.id_elections }).update(row);
      return res.json({ success: true, message: 'Election saved', id: e.id_elections });
    }
    const [id] = await db('elections').insert({ ...row, is_secret: b.is_secret !== false, status: 'DRAFT', created_by: userName(req) });
    // Start with the usual posts; they can be changed before voting opens.
    const defaults = [['PRESIDENT', 1], ['VICE_PRESIDENT', 1], ['GENERAL_SECRETARY', 1], ['JOINT_SECRETARY', 1], ['TREASURER', 1], ['MEMBER', 3]];
    await db('election_positions').insert(defaults.map(([position, seats], i) => ({ id_elections: id, position, seats, sort_order: i })));
    res.json({ success: true, message: 'Election created with the usual posts — adjust seats and add candidates', id });
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    const showResults = ['CLOSED', 'PUBLISHED'].includes(e.status);
    res.json({ success: true, election: { ...e, phase: phase(e) }, positions: showResults ? null : await ballotData(e.id_elections),
      results: showResults ? await results(e) : null, turnout: await turnout(e), owners: await members(), symbols: SYMBOL_KEYS, positions_all: POSITIONS });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (!['DRAFT', 'CANCELLED'].includes(e.status)) throw bad('Only a draft or cancelled election can be deleted');
    await db.transaction(async trx => {
      const ballots = await trx('election_ballots').where({ id_elections: e.id_elections }).pluck('id_ballots');
      if (ballots.length) await trx('election_ballot_choices').whereIn('id_ballots', ballots).del();
      for (const tbl of ['election_ballots', 'election_voters', 'election_candidates', 'election_positions']) await trx(tbl).where({ id_elections: e.id_elections }).del();
      await trx('elections').where({ id_elections: e.id_elections }).del();
    });
    res.json({ success: true, message: 'Election deleted' });
  } catch (err) { fail(res, err); }
});

// Body: { positions: [{ position, seats }] } in ballot order — replaces the list (draft only).
router.put('/:id/positions', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (e.status !== 'DRAFT') throw bad('Posts can only be changed before voting opens');
    const list = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const seen = new Set();
    const rows = list.map((p, i) => {
      if (!POSITIONS.includes(p.position)) throw bad('Unknown post');
      if (seen.has(p.position)) throw bad('Each post can be listed once');
      seen.add(p.position);
      const seats = Math.round(Number(p.seats));
      if (!(seats >= 1 && seats <= 30)) throw bad('Seats must be between 1 and 30');
      if (p.position !== 'MEMBER' && seats !== 1) throw bad('Office-bearer posts have one seat; use "Member" for several');
      return { position: p.position, seats, sort_order: i };
    });
    if (!rows.length) throw bad('Keep at least one post');
    await db.transaction(async trx => {
      const existing = await trx('election_positions').where({ id_elections: e.id_elections });
      const keep = new Map(existing.map(p => [p.position, p]));
      const removed = existing.filter(p => !seen.has(p.position)).map(p => p.id_positions);
      if (removed.length) {
        if (await trx('election_candidates').whereIn('id_positions', removed).first()) throw bad('Remove the candidates of a post before removing the post');
        await trx('election_positions').whereIn('id_positions', removed).del();
      }
      for (const r of rows) {
        if (keep.has(r.position)) await trx('election_positions').where({ id_positions: keep.get(r.position).id_positions }).update({ seats: r.seats, sort_order: r.sort_order });
        else await trx('election_positions').insert({ ...r, id_elections: e.id_elections });
      }
    });
    res.json({ success: true, message: 'Posts saved' });
  } catch (err) { fail(res, err); }
});

router.post('/:id/candidates', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (e.status !== 'DRAFT') throw bad('Candidates can only be changed before voting opens');
    const b = req.body || {};
    const pos = await db('election_positions').where({ id_positions: b.id_positions, id_elections: e.id_elections }).first();
    if (!pos) throw bad('Choose the post');
    if (!SYMBOL_KEYS.includes(b.symbol_key)) throw bad('Choose a ballot symbol');
    if (!(await members()).some(m => m.id_owners === Number(b.id_owners))) throw bad('Candidates must be flat owners with an active flat');
    const others = db('election_candidates').where({ id_elections: e.id_elections }).whereNot('id_candidates', b.id_candidates || 0);
    if (await others.clone().where({ id_owners: b.id_owners }).first()) throw bad('This owner is already a candidate in this election (one post per person)');
    const symbolTaken = await others.clone().where({ symbol_key: b.symbol_key }).first();
    if (symbolTaken) throw bad('Another candidate already has this symbol');
    const row = { id_positions: pos.id_positions, id_owners: Number(b.id_owners), symbol_key: b.symbol_key, manifesto: b.manifesto ? String(b.manifesto).slice(0, 500) : null };
    if (b.id_candidates) {
      await db('election_candidates').where({ id_candidates: b.id_candidates, id_elections: e.id_elections }).update(row);
      return res.json({ success: true, message: 'Candidate updated' });
    }
    const [id] = await db('election_candidates').insert({ ...row, id_elections: e.id_elections, status: 'APPROVED' });
    res.json({ success: true, message: 'Candidate registered', id });
  } catch (err) { fail(res, err); }
});

router.delete('/:id/candidates/:cid', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (e.status !== 'DRAFT') throw bad('Candidates can only be removed before voting opens');
    await db('election_candidates').where({ id_candidates: req.params.cid, id_elections: e.id_elections }).del();
    res.json({ success: true, message: 'Candidate removed' });
  } catch (err) { fail(res, err); }
});

// ── Staff: status changes ───────────────────────────────────────
router.post('/:id/status', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    const to = req.body?.status;
    if (!STATUSES.includes(to)) throw bad('Unknown status');
    const positions = await ballotData(e.id_elections);
    const allowed = { DRAFT: ['OPEN', 'CLOSED', 'CANCELLED'], OPEN: ['CLOSED', 'CANCELLED'], CLOSED: ['PUBLISHED', 'OPEN'], PUBLISHED: [], CANCELLED: [] }[e.status];
    if (!allowed.includes(to)) throw bad(`A ${e.status.toLowerCase()} election cannot be set to ${to.toLowerCase()}`);
    const update = { status: to };
    if (e.status === 'DRAFT') {
      const empty = positions.filter(p => !p.candidates.length);
      if (empty.length) throw bad(`No candidates yet for: ${empty.map(p => p.position.replace(/_/g, ' ').toLowerCase()).join(', ')}. Add candidates or remove those posts.`);
      const contested = positions.some(p => p.contested);
      if (to === 'OPEN' && !contested) throw bad('Every post is uncontested — no vote is needed. Use "Close" to declare everyone elected unopposed.');
      if (to === 'CLOSED' && contested) throw bad('Some posts are contested — open voting first');
    }
    if (e.status === 'CLOSED' && to === 'OPEN') {
      // Re-opening is only for extending a vote that was closed too early.
      if (new Date(e.voting_closes_at) <= new Date()) throw bad('Move the closing time later first (edit the election), then re-open');
    }
    if (to === 'PUBLISHED') {
      const r = await results(e);
      if (r.unresolved_ties) throw bad('There is a tie for the last seat of a post — settle it by drawing lots first');
      update.published_at = new Date();
    }
    if (to === 'CLOSED' && e.status === 'OPEN' && new Date() < new Date(e.voting_closes_at)) update.voting_closes_at = new Date(); // closed early
    await db('elections').where({ id_elections: e.id_elections }).update(update);
    res.json({ success: true, message: { OPEN: 'Voting is open', CLOSED: 'Voting closed — results are ready to review', PUBLISHED: 'Result published to owners', CANCELLED: 'Election cancelled' }[to] });
  } catch (err) { fail(res, err); }
});

// Tie for the last seat(s): record the candidate(s) who won the draw of lots.
router.post('/:id/tie-break', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (e.status !== 'CLOSED') throw bad('Ties are settled after voting closes and before publishing');
    const r = await results(e);
    const p = r.positions.find(x => x.id_positions === Number(req.body?.id_positions));
    if (!p?.tie) throw bad('There is no tie for this post');
    const winners = (Array.isArray(req.body?.winners) ? req.body.winners : []).map(Number);
    if (winners.length !== p.tie.seats_left || !winners.every(w => p.tie.candidates.includes(w))) throw bad(`Choose exactly ${p.tie.seats_left} of the tied candidates`);
    await db.transaction(async trx => {
      await trx('election_candidates').whereIn('id_candidates', p.tie.candidates).update({ won_by_lot: false });
      await trx('election_candidates').whereIn('id_candidates', winners).update({ won_by_lot: true });
    });
    res.json({ success: true, message: 'Draw of lots recorded' });
  } catch (err) { fail(res, err); }
});

// Make the winners the managing committee: current members' terms end the day before the new term.
router.post('/:id/install', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (e.status !== 'PUBLISHED') throw bad('Publish the result first');
    if (e.committee_installed) throw bad('This committee is already installed');
    const r = await results(e);
    const term = ymd(e.term_start);
    const dayBefore = ymd(new Date(new Date(`${term}T00:00:00`).getTime() - 86400000));
    const owners = new Map((await db('owners').select('id_owners', 'full_name', 'phone')).map(o => [o.id_owners, o]));
    const rows = r.positions.flatMap(p => p.candidates.filter(c => c.elected).map(c => ({
      id_owners: c.id_owners, member_name: owners.get(c.id_owners)?.full_name || c.full_name, phone: owners.get(c.id_owners)?.phone || null,
      position: p.position, term_start: term, term_end: e.term_end ? ymd(e.term_end) : null, id_meetings: e.id_meetings || null,
    })));
    await db.transaction(async trx => {
      await trx('committee_members').where('term_start', '<', term).where(w => w.whereNull('term_end').orWhere('term_end', '>=', term)).update({ term_end: dayBefore });
      await trx('committee_members').insert(rows);
      await trx('elections').where({ id_elections: e.id_elections }).update({ committee_installed: true });
    });
    res.json({ success: true, message: `${rows.length} members installed as the committee from ${term}` });
  } catch (err) { fail(res, err); }
});

// Who has voted (never how) — for the polling officer and turnout reminders.
router.get('/:id/voters', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    const voted = new Map((await db('election_voters').where({ id_elections: e.id_elections })).map(v => [v.id_owners, v]));
    const rows = (await members()).map(m => ({ ...m, flat_count: Number(m.flat_count), voted: voted.has(m.id_owners), voted_at: voted.get(m.id_owners)?.voted_at || null, channel: voted.get(m.id_owners)?.channel || null }));
    // Open (non-secret) elections may show each owner's choices.
    let choices = null;
    if (!e.is_secret && ['CLOSED', 'PUBLISHED'].includes(e.status)) {
      const cs = await db('election_ballots as b').join('election_ballot_choices as c', 'c.id_ballots', 'b.id_ballots').join('election_candidates as k', 'k.id_candidates', 'c.id_candidates')
        .join('owners as o', 'o.id_owners', 'k.id_owners').where('b.id_elections', e.id_elections).select('b.id_owners', 'o.full_name as candidate');
      choices = {};
      for (const c of cs) (choices[c.id_owners] ||= []).push(c.candidate);
    }
    res.json({ success: true, rows, choices });
  } catch (err) { fail(res, err); }
});

// SMS every member that voting is open, with the times.
router.post('/:id/notice', async (req, res) => {
  try {
    const e = await getElection(req.params.id);
    if (!['DRAFT', 'OPEN'].includes(e.status)) throw bad('Notices can be sent before or during voting');
    const tpl = await sms.getTemplate('ELECTION_NOTICE');
    if (!tpl || !tpl.is_active) throw bad('The election SMS template is switched off (Collections → SMS templates)');
    const settings = await getSettings();
    const bn = settings.sms_language !== 'en';
    const fmt = d => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')} ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`; };
    const onlyPending = req.body?.only_not_voted === true;
    const done = onlyPending ? new Set(await db('election_voters').where({ id_elections: e.id_elections }).pluck('id_owners')) : new Set();
    const seen = new Set();
    const out = { sent: 0, failed: 0, skipped: 0 };
    for (const m of await members()) {
      const msisdn = sms.toMsisdn(m.phone);
      if (done.has(m.id_owners) || !msisdn || seen.has(msisdn)) { out.skipped++; continue; }
      seen.add(msisdn);
      const r = await sms.sendSms({ to: m.phone, recipient_name: m.full_name, template_key: 'ELECTION_NOTICE', related_type: 'ELECTION', related_key: String(e.id_elections), created_by: userName(req),
        message: sms.render(bn ? tpl.body_bn : tpl.body_en, { name: m.full_name, title: e.title, opens: fmt(e.voting_opens_at), closes: fmt(e.voting_closes_at), org: settings.sms_signature }) });
      out[r.status === 'FAILED' ? 'failed' : 'sent']++;
    }
    if (!onlyPending) await db('elections').where({ id_elections: e.id_elections }).update({ notice_sent_at: new Date() });
    res.json({ success: true, message: `SMS sent to ${out.sent} owner(s)${out.failed ? `, ${out.failed} failed` : ''}`, ...out });
  } catch (err) { fail(res, err); }
});

// ── Casting a ballot ────────────────────────────────────────────
const RECEIPT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const receiptCode = () => { const b = crypto.randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += RECEIPT_ALPHABET[b[i] % RECEIPT_ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };

// choices: { [id_positions]: [id_candidates, ...] } — a post left out is a blank vote for that post.
async function castBallot(e, ownerId, choices, { channel, recordedBy }) {
  if (phase(e) !== 'VOTING') throw bad(phase(e) === 'NOT_YET' ? 'Voting has not opened yet' : 'Voting is closed');
  const member = (await members()).find(m => m.id_owners === ownerId);
  if (!member) throw bad('Only owners with an active flat can vote');
  const positions = (await ballotData(e.id_elections)).filter(p => p.contested);
  const rows = [];
  for (const p of positions) {
    const picked = [...new Set((choices?.[p.id_positions] || []).map(Number))];
    if (picked.length > p.seats) throw bad(`Too many choices for ${p.position.replace(/_/g, ' ').toLowerCase()} — at most ${p.seats}`);
    for (const id of picked) {
      if (!p.candidates.some(c => c.id_candidates === id)) throw bad('A choice is not a candidate for that post');
      rows.push({ id_positions: p.id_positions, id_candidates: id });
    }
  }
  const id_ballots = crypto.randomUUID();
  const code = receiptCode();
  await db.transaction(async trx => {
    try {
      await trx('election_voters').insert({ id_elections: e.id_elections, id_owners: ownerId, channel, recorded_by: recordedBy || null });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw bad('This owner has already voted');
      throw err;
    }
    await trx('election_ballots').insert({ id_ballots, id_elections: e.id_elections, receipt_code: code, cast_on: today(),
      weight: e.vote_basis === 'PER_FLAT' ? Math.max(1, Number(member.flat_count) || 1) : 1, id_owners: e.is_secret ? null : ownerId });
    if (rows.length) await trx('election_ballot_choices').insert(rows.map(r => ({ ...r, id_ballots })));
  });
  return code;
}

// Polling booth: a staff member checks the owner's identity, starts a ballot, and hands over the device.
// The token is single-use and only lives in this process's memory.
const boothTokens = new Map();
const sweep = () => { const now = Date.now(); for (const [k, v] of boothTokens) if (v.expires < now) boothTokens.delete(k); };

router.post('/:id/booth/start', async (req, res) => {
  try {
    sweep();
    const e = await getElection(req.params.id);
    if (phase(e) !== 'VOTING') throw bad('Voting is not open right now');
    const ownerId = Number(req.body?.id_owners);
    const member = (await members()).find(m => m.id_owners === ownerId);
    if (!member) throw bad('Only owners with an active flat can vote');
    if (await db('election_voters').where({ id_elections: e.id_elections, id_owners: ownerId }).first()) throw bad(`${member.full_name} has already voted`);
    const token = crypto.randomBytes(24).toString('hex');
    boothTokens.set(token, { id_elections: e.id_elections, id_owners: ownerId, staff: userName(req), expires: Date.now() + BOOTH_TOKEN_MS });
    res.json({ success: true, token, voter: { full_name: member.full_name, flats: member.flats }, positions: (await ballotData(e.id_elections)).filter(p => p.contested), election: { title: e.title } });
  } catch (err) { fail(res, err); }
});

router.post('/:id/booth/cast', async (req, res) => {
  try {
    sweep();
    const t = boothTokens.get(req.body?.token);
    if (!t || t.id_elections !== Number(req.params.id)) throw bad('This ballot has expired — start again from the voter list');
    boothTokens.delete(req.body.token);
    const e = await getElection(t.id_elections);
    const receipt = await castBallot(e, t.id_owners, req.body?.choices, { channel: 'BOOTH', recordedBy: t.staff });
    res.json({ success: true, message: 'Vote recorded', receipt });
  } catch (err) { fail(res, err); }
});

// ── Owner portal ────────────────────────────────────────────────
async function portalOwner(req) {
  const o = await db('owners').where('login_email', req.user.email).first();
  if (!o) throw Object.assign(new Error('No flat owner profile is linked to this login'), { status: 404 });
  return o;
}

router.get('/portal', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const recent = ymd(new Date(Date.now() - 365 * 86400000));
    const list = await db('elections').whereIn('status', ['OPEN', 'CLOSED', 'PUBLISHED']).where('voting_closes_at', '>=', recent).orderBy('voting_opens_at', 'desc');
    const isMember = (await members()).some(m => m.id_owners === owner.id_owners);
    const out = [];
    for (const e of list) {
      const v = await db('election_voters').where({ id_elections: e.id_elections, id_owners: owner.id_owners }).first();
      const ph = phase(e);
      out.push({
        id_elections: e.id_elections, title: e.title, voting_opens_at: e.voting_opens_at, voting_closes_at: e.voting_closes_at, term_start: e.term_start, term_end: e.term_end,
        is_secret: !!e.is_secret, vote_basis: e.vote_basis, rules_note: e.rules_note, status: e.status, phase: ph, eligible: isMember, has_voted: !!v, voted_at: v?.voted_at || null,
        positions: ph === 'VOTING' || ph === 'NOT_YET' ? await ballotData(e.id_elections) : null,
        results: e.status === 'PUBLISHED' ? await results(e) : null,
      });
    }
    res.json({ success: true, rows: out });
  } catch (err) { fail(res, err); }
});

router.post('/portal/:id/ballot', async (req, res) => {
  try {
    const owner = await portalOwner(req);
    const e = await getElection(req.params.id);
    const receipt = await castBallot(e, owner.id_owners, req.body?.choices, { channel: 'PORTAL' });
    res.json({ success: true, message: 'Your vote has been recorded', receipt });
  } catch (err) { fail(res, err); }
});

// Anyone holding a receipt can confirm that their ballot is in the count — it shows nothing about the choices.
router.get('/portal/:id/receipt/:code', async (req, res) => {
  try {
    const b = await db('election_ballots').where({ id_elections: req.params.id, receipt_code: String(req.params.code).toUpperCase() }).first();
    res.json({ success: true, counted: !!b, cast_on: b ? ymd(b.cast_on) : null });
  } catch (err) { fail(res, err); }
});

module.exports = router;
