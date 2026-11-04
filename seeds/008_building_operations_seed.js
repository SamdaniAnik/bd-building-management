// Sample data for Building Operations (migration 018): tenants & rent, service charge bills,
// building staff & payroll, visitors, parking and notices.
//
//   npx knex seed:run --knexfile knexfile.js --specific=008_building_operations_seed.js
//
// Re-running resets ONLY the operations tables (and service charge bills created by billing runs).
// It issues no money receipts and sends no SMS. Bills and payslips are calculated with the same
// code the app uses (routes/ops/billing.js, routes/ops/staff.js).
const { computeRun } = require('../routes/ops/billing');
const { computePayroll } = require('../routes/ops/staff');

const round2 = n => Math.round(n * 100) / 100;
let seed = 20261104;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickOne = arr => arr[Math.floor(rand() * arr.length)];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const METHODS = ['CASH', 'BKASH', 'BKASH', 'NAGAD', 'BANK', 'CASH', 'ROCKET'];
const trx = () => Math.random().toString(36).slice(2, 12).toUpperCase();

exports.seed = async function (knex) {
  const today = ymd(new Date());
  const thisMonth = today.slice(0, 7);
  const prevMonth = (() => { const d = new Date(`${thisMonth}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); })();
  const prev2Month = (() => { const d = new Date(`${thisMonth}-01T00:00:00`); d.setMonth(d.getMonth() - 2); return ymd(d).slice(0, 7); })();

  // ── Reset ──────────────────────────────────────────────────────
  const runBills = await knex('service_charges').whereNotNull('id_runs').pluck('id_service_charges');
  if (runBills.length) await knex('service_charges').whereIn('id_service_charges', runBills).del();
  for (const t of ['tenants', 'rent_agreements', 'rent_invoices', 'rent_payments', 'service_charge_runs', 'service_charge_lines', 'service_charge_payments',
    'building_staff', 'staff_attendance', 'staff_advances', 'staff_payslips', 'visitor_logs', 'parking_slots', 'notices']) await knex(t).del();

  const units = await knex('units').where({ status: 'OWNED' }).where(q => q.whereNull('is_common_share').orWhere('is_common_share', false)).orderBy('id_units');
  if (units.length < 20) { console.log('Building operations seed: not enough OWNED flats — run the earlier seeds first.'); return; }
  const owners = {};
  for (const r of await knex('unit_ownerships').whereIn('id_units', units.map(u => u.id_units)).orderBy('ownership_percentage', 'desc')) if (!owners[r.id_units]) owners[r.id_units] = r.id_owners;

  // ── 1. Tenants & rent ──────────────────────────────────────────
  const T = [
    { u: 3, full_name: 'Md. Tanvir Ahmed', father_name: 'Md. Abul Kalam', date_of_birth: '1988-03-14', marital_status: 'MARRIED', religion: 'Islam', education: 'MBA', occupation: 'Senior Officer, BRAC Bank', workplace_address: 'Anik Tower, Gulshan-1, Dhaka', phone: '01712345601', email: 'tanvir.ahmed@example.com', nid_no: '1988263741', permanent_address: 'Vill: Char Fasson, Bhola', emergency: ['Md. Abul Kalam', 'Father', '01712345611', 'Char Fasson, Bhola'], family: [['Nusrat Jahan', '33', 'Wife', 'Teacher'], ['Arham Ahmed', '6', 'Son', 'Student']], helper: ['Rahima Begum', '19762611234', '01912345671', 'Bhola Sadar'], start: '2025-06-01', rent: 28000, other: 2500, label: 'Gas, water & service charge', advance: 56000, due: 5, inc: 5, police: true, thana: 'Uttara West', prev: ['Shafiqul Islam', '01812345681', 'Road 7, Sector 4, Uttara', 'Needed a bigger flat'] },
    { u: 7, full_name: 'Dr. Farhana Rahman', father_name: 'A. K. M. Rahman', date_of_birth: '1985-09-02', marital_status: 'MARRIED', religion: 'Islam', education: 'MBBS, FCPS', occupation: 'Consultant, Kurmitola General Hospital', workplace_address: 'Kurmitola, Dhaka Cantonment', phone: '01812345602', nid_no: '1985263741223', permanent_address: 'House 22, Zindabazar, Sylhet', emergency: ['Rafiq Rahman', 'Brother', '01812345612', 'Sylhet'], family: [['Kamrul Hasan', '40', 'Husband', 'Engineer'], ['Ayesha Hasan', '10', 'Daughter', 'Student'], ['Rayan Hasan', '7', 'Son', 'Student']], driver: ['Md. Jalal Uddin', '19852611771', '01612345673', 'Sunamganj'], start: '2024-12-01', rent: 35000, other: 0, advance: 70000, due: 1, inc: 0, police: true, thana: 'Uttara West' },
    { u: 12, full_name: 'Sajib Chowdhury', father_name: 'Ratan Chowdhury', date_of_birth: '1992-11-21', marital_status: 'SINGLE', religion: 'Hinduism', education: 'BSc in CSE', occupation: 'Software Engineer, bKash Ltd', workplace_address: 'SKS Tower, Mohakhali, Dhaka', phone: '01912345603', nid_no: '1992263744', permanent_address: 'Patiya, Chattogram', emergency: ['Ratan Chowdhury', 'Father', '01912345613', 'Patiya, Chattogram'], family: [['Pritom Das', '29', 'Flatmate', 'Engineer']], start: '2026-02-01', rent: 22000, other: 1500, label: 'Service charge', advance: 44000, due: 7, inc: 0, police: false, prev: ['Mrs. Laila Haque', '01712000001', 'Mirpur DOHS', 'Closer to office'] },
    { u: 18, full_name: 'Nasima Akter', father_name: 'Late Abdur Rob', date_of_birth: '1979-05-30', marital_status: 'WIDOWED', religion: 'Islam', education: 'HSC', occupation: 'Business (boutique)', workplace_address: 'Rapa Plaza, Dhanmondi', phone: '01612345604', nid_no: '1979263745', permanent_address: 'Feni Sadar, Feni', emergency: ['Md. Shahin', 'Son', '01612345614', 'Uttara, Dhaka'], family: [['Tania Akter', '17', 'Daughter', 'Student']], helper: ['Jorina Khatun', '19902611888', '01712345675', 'Feni'], start: '2025-01-15', end: addDays(today, 41), rent: 18000, other: 2000, label: 'Gas & water', advance: 36000, due: 3, inc: 5, police: true, thana: 'Uttara West' },
    { u: 25, full_name: 'Imran Hossain', father_name: 'Md. Delwar Hossain', date_of_birth: '1990-01-08', marital_status: 'MARRIED', religion: 'Islam', education: 'BBA', occupation: 'Sales Manager, Pran-RFL', workplace_address: 'Pran-RFL Centre, Badda', phone: '01312345605', nid_no: '1990263746557', permanent_address: 'Kushtia Sadar, Kushtia', emergency: ['Sharmin Sultana', 'Wife', '01312345615', 'Uttara, Dhaka'], family: [['Sharmin Sultana', '30', 'Wife', 'Homemaker'], ['Ishmam Hossain', '3', 'Son', '']], start: '2025-09-01', rent: 25000, other: 0, advance: 50000, due: 5, inc: 0, police: true, thana: 'Uttara West' },
    { u: 33, full_name: 'Rezaul Karim', father_name: 'Md. Abdul Karim', date_of_birth: '1983-07-17', marital_status: 'MARRIED', religion: 'Islam', education: 'MSc', occupation: 'Govt. service (Ministry of Education)', workplace_address: 'Bangladesh Secretariat, Dhaka', phone: '01512345606', nid_no: '1983263747', permanent_address: 'Rangpur Sadar, Rangpur', emergency: ['Md. Abdul Karim', 'Father', '01512345616', 'Rangpur'], family: [['Mahmuda Karim', '36', 'Wife', 'Banker'], ['Rafid Karim', '12', 'Son', 'Student'], ['Raisa Karim', '9', 'Daughter', 'Student'], ['Md. Abdul Karim', '68', 'Father', 'Retired']], start: '2024-08-01', rent: 30000, other: 2500, label: 'Gas, water & service charge', advance: 60000, due: 10, inc: 8, police: true, thana: 'Uttara West', partialLastMonth: true },
    { u: 41, full_name: 'Anika Tabassum', father_name: 'Md. Habibur Rahman', date_of_birth: '1996-12-03', marital_status: 'SINGLE', religion: 'Islam', education: 'LLB', occupation: 'Associate, law chamber', workplace_address: 'Supreme Court Bar, Dhaka', phone: '01712345607', nid_no: '1996263748', permanent_address: 'Mymensingh Sadar', emergency: ['Md. Habibur Rahman', 'Father', '01712345617', 'Mymensingh'], family: [['Lamia Islam', '27', 'Flatmate', 'Doctor']], start: '2026-07-01', rent: 20000, other: 1500, label: 'Service charge', advance: 40000, due: 2, inc: 0, police: false, unpaidNow: true },
    { u: 52, full_name: 'Tapan Kumar Saha', father_name: 'Nikhil Chandra Saha', date_of_birth: '1981-04-25', marital_status: 'MARRIED', religion: 'Hinduism', education: 'BCom', occupation: 'Proprietor, Saha Traders', workplace_address: 'Shankhari Bazar, Old Dhaka', phone: '01812345608', nid_no: '1981263749', permanent_address: 'Tangail Sadar, Tangail', emergency: ['Swapan Saha', 'Brother', '01812345618', 'Tangail'], family: [['Rina Saha', '39', 'Wife', 'Homemaker'], ['Joy Saha', '14', 'Son', 'Student']], driver: ['Md. Kashem', '19792611999', '01912345679', 'Tangail'], start: '2025-03-01', rent: 32000, other: 0, advance: 64000, due: 5, inc: 5, police: true, thana: 'Uttara West' },
  ];
  const left = { u: 60, full_name: 'Mahbub Alam', father_name: 'Md. Nurul Alam', phone: '01712345609', nid_no: '1987263750', occupation: 'Banker', start: '2025-02-01', end: `${prev2Month}-30`, rent: 24000 };

  const person = ([name, nid_no, phone, permanent_address]) => ({ name, nid_no, phone, permanent_address });
  const rentFor = (a, month) => {
    const [sy, sm] = a.start_date.split('-').map(Number); const [y, m] = month.split('-').map(Number);
    const years = Math.max(0, Math.floor(((y - sy) * 12 + (m - sm)) / 12));
    return round2(a.monthly_rent_bdt * Math.pow(1 + (a.annual_increase_percent || 0) / 100, years));
  };
  const dueDate = (month, day) => `${month}-${pad(Math.min(day, daysIn(month)))}`;

  let tenantCount = 0; let invCount = 0;
  for (const x of [...T, left]) {
    const unit = units[x.u % units.length];
    const isLeft = x === left;
    const [id_tenants] = await knex('tenants').insert({
      id_units: unit.id_units, full_name: x.full_name, father_name: x.father_name, date_of_birth: x.date_of_birth || null, marital_status: x.marital_status || null,
      permanent_address: x.permanent_address || null, occupation: x.occupation, workplace_address: x.workplace_address || null, religion: x.religion || null,
      education: x.education || null, phone: x.phone, email: x.email || null, nid_no: x.nid_no,
      emergency_name: x.emergency?.[0] || null, emergency_relation: x.emergency?.[1] || null, emergency_phone: x.emergency?.[2] || null, emergency_address: x.emergency?.[3] || null,
      family_members: JSON.stringify((x.family || []).map(([name, age, relation, occupation]) => ({ name, age, relation, occupation }))),
      domestic_helpers: JSON.stringify(x.helper ? [person(x.helper)] : []), drivers: JSON.stringify(x.driver ? [person(x.driver)] : []),
      prev_landlord_name: x.prev?.[0] || null, prev_landlord_phone: x.prev?.[1] || null, prev_address: x.prev?.[2] || null, reason_for_leaving_prev: x.prev?.[3] || null,
      move_in_date: x.start, move_out_date: isLeft ? x.end : null, status: isLeft ? 'LEFT' : 'ACTIVE',
      police_form_submitted: !!x.police, police_form_date: x.police ? addDays(x.start, 6) : null, police_station: x.thana || 'Uttara West',
    });
    tenantCount++;
    const a = { id_tenants, id_units: unit.id_units, id_owners: owners[unit.id_units] || null, start_date: x.start, end_date: x.end || null,
      monthly_rent_bdt: x.rent, other_monthly_bdt: x.other || 0, other_monthly_label: x.label || null, advance_deposit_bdt: x.advance || x.rent * 2,
      due_day: x.due || 5, annual_increase_percent: x.inc || 0, notice_period_months: 2, status: isLeft ? 'ENDED' : 'ACTIVE' };
    const [id_rent_agreements] = await knex('rent_agreements').insert(a);

    for (const month of [prev2Month, prevMonth, thisMonth]) {
      if (month < x.start.slice(0, 7) || (a.end_date && month > a.end_date.slice(0, 7))) continue;
      const rent = rentFor(a, month); const other = a.other_monthly_bdt; const total = round2(rent + other);
      const due = dueDate(month, a.due_day);
      let paid = total;
      if (month === prevMonth && x.partialLastMonth) paid = round2(total - 12500);
      if (month === thisMonth) paid = x.unpaidNow || due > today ? (rand() < 0.35 && !x.unpaidNow ? total : 0) : total;
      const [id_rent_invoices] = await knex('rent_invoices').insert({ id_rent_agreements, billing_month: month, rent_bdt: rent, other_bdt: other, total_bdt: total,
        amount_paid: paid, due_date: due, status: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID' });
      invCount++;
      if (paid > 0) {
        const on = due > today ? today : addDays(due, Math.floor(rand() * 4) - 2);
        const m = pickOne(METHODS);
        await knex('rent_payments').insert({ id_rent_invoices, amount_bdt: paid, paid_on: on > today ? today : on, payment_method: m, reference: m === 'CASH' ? null : trx(), received_by: 'Kabir Hossain (Project Manager)' });
      }
    }
  }

  // ── 2. Service charge billing ──────────────────────────────────
  const sharedFor = month => month === thisMonth
    ? [{ description: 'DESCO common-area meter', total_bdt: 96400, split: 'EQUAL' }, { description: 'Generator diesel', total_bdt: 38500, split: 'SFT' }]
    : [{ description: 'DESCO common-area meter', total_bdt: 104800, split: 'EQUAL' }, { description: 'Generator diesel', total_bdt: 52000, split: 'SFT' }, { description: 'WASA pump & water tank cleaning', total_bdt: 18000, split: 'EQUAL' }];
  let billCount = 0; let scPaid = 0;
  for (const month of [prevMonth, thisMonth]) {
    const due = `${month}-10`;
    const run = await computeRun({ billing_month: month, due_date: due, shared_costs: sharedFor(month) });
    const [id_runs] = await knex('service_charge_runs').insert({ billing_month: month, due_date: due, bill_count: run.bills.length, total_bdt: run.total_bdt,
      heads_json: JSON.stringify(run.heads), shared_costs_json: JSON.stringify(run.shared), unit_statuses: run.statuses.join(','), generated_by: 'Farzana Akter (Chief Accountant)',
      created_at: `${addDays(`${month}-01`, -2)} 10:30:00` });
    for (const b of run.bills) {
      const r = rand();
      // last month: ~85% paid (some late, with fine), ~4% part-paid, rest overdue · this month: ~30% paid early
      let paid = 0; let fine = 0; let on = null;
      if (month === prevMonth) {
        if (r < 0.72) { paid = b.total_bdt; on = addDays(`${month}-01`, Math.floor(rand() * 9) + 1); }
        else if (r < 0.85) { paid = b.total_bdt; on = addDays(due, Math.floor(rand() * 15) + 11); fine = 100; }
        else if (r < 0.89) { paid = round2(Math.round(b.total_bdt / 2)); on = addDays(due, 5); }
      } else if (r < 0.3) { paid = b.total_bdt; on = addDays(`${month}-01`, Math.floor(rand() * 4)); }
      if (on && on > today) on = today;
      const status = paid >= b.total_bdt ? 'PAID' : due < today ? 'OVERDUE' : 'UNPAID';
      const [id] = await knex('service_charges').insert({ id_units: b.id_units, billing_month: month, monthly_fee: b.total_bdt, late_fee: 0, amount_paid: paid, due_date: due, status, id_runs });
      await knex('service_charge_lines').insert(b.lines.map(l => ({ ...l, id_service_charges: id })));
      billCount++;
      if (paid > 0) {
        const m = pickOne(METHODS);
        await knex('service_charge_payments').insert({ id_service_charges: id, amount_bdt: paid, fine_bdt: fine, paid_on: on, payment_method: m, reference: m === 'CASH' ? null : trx(), received_by: 'Farzana Akter (Chief Accountant)' });
        scPaid++;
      }
    }
  }

  // ── 3. Building staff & payroll ────────────────────────────────
  const S = [
    ['Md. Abdul Malek', 'GUARD', 'NIGHT', 16000, '01711987601', '2024-03-01', 'BKASH', '01711987601', null],
    ['Md. Shahidul Islam', 'GUARD', 'NIGHT', 15000, '01811987602', '2024-06-15', 'BKASH', '01811987602', null],
    ['Md. Rubel Mia', 'GUARD', 'DAY', 15000, '01911987603', '2025-01-10', 'NAGAD', '01911987603', 'Elite Security Services Ltd'],
    ['Md. Saiful Islam', 'GUARD', 'DAY', 15000, '01611987604', `${prevMonth}-16`, 'NAGAD', '01611987604', 'Elite Security Services Ltd'],
    ['Md. Nazrul Islam', 'CARETAKER', 'GENERAL', 22000, '01711987605', '2023-11-01', 'BANK', 'Dutch-Bangla 1051100045678', null],
    ['Gopal Chandra Das', 'CLEANER', 'DAY', 11000, '01811987606', '2024-02-01', 'CASH', null, null],
    ['Morjina Begum', 'CLEANER', 'DAY', 10000, '01911987607', '2024-09-01', 'BKASH', '01911987607', null],
    ['Md. Alamgir Hossain', 'LIFT_OPERATOR', 'ROTATING', 13000, '01511987608', '2024-05-01', 'BKASH', '01511987608', null],
    ['Md. Sohel Rana', 'ELECTRICIAN', 'GENERAL', 18000, '01311987609', '2024-07-01', 'BKASH', '01311987609', null],
  ];
  const staffIds = [];
  for (const [full_name, role, shift, salary, phone, join_date, payment_method, wallet, agency] of S) {
    const [id] = await knex('building_staff').insert({ full_name, role, shift, monthly_salary_bdt: salary, phone, join_date, payment_method, wallet_or_account: wallet, agency_name: agency,
      nid_no: `19${String(80 + staffIds.length).slice(-2)}26${String(1000 + staffIds.length * 37).slice(-4)}`, permanent_address: pickOne(['Kurigram', 'Jamalpur', 'Barishal', 'Netrokona', 'Gaibandha', 'Bhola']), status: 'ACTIVE' });
    staffIds.push(id);
  }
  const [leftStaff] = await knex('building_staff').insert({ full_name: 'Md. Kamal Uddin', role: 'GUARD', shift: 'DAY', monthly_salary_bdt: 14500, phone: '01711987610', join_date: '2024-01-01', leave_date: `${prevMonth}-15`, payment_method: 'CASH', status: 'LEFT', agency_name: 'Elite Security Services Ltd' });

  const att = [];
  const people = await knex('building_staff').select('id_staff', 'shift', 'join_date', 'leave_date', 'status');
  for (let day = `${prevMonth}-01`; day < today; day = addDays(day, 1)) {
    for (const p of people) {
      if (ymd(new Date(p.join_date)) > day || (p.leave_date && ymd(new Date(p.leave_date)) < day)) continue;
      const r = rand();
      const status = r < 0.04 ? 'ABSENT' : r < 0.07 ? 'LEAVE' : r < 0.09 ? 'HALF_DAY' : 'PRESENT';
      const ot = status === 'PRESENT' && p.shift === 'NIGHT' && rand() < 0.12 ? pickOne([2, 3, 4]) : 0;
      att.push({ id_staff: p.id_staff, att_date: day, status, overtime_hours: ot, note: status === 'LEAVE' ? pickOne(['Sick', 'Family event', 'Went home']) : null });
    }
  }
  for (let i = 0; i < att.length; i += 300) await knex('staff_attendance').insert(att.slice(i, i + 300));

  await knex('staff_advances').insert([
    { id_staff: staffIds[0], amount_bdt: 6000, given_on: addDays(`${prevMonth}-01`, -10), monthly_recovery_bdt: 2000, recovered_bdt: 0, reason: "Daughter's school admission", status: 'OPEN' },
    { id_staff: staffIds[4], amount_bdt: 3000, given_on: `${prevMonth}-12`, monthly_recovery_bdt: 0, recovered_bdt: 0, reason: 'Medical', status: 'OPEN' },
    { id_staff: staffIds[7], amount_bdt: 4000, given_on: addDays(today, -2), monthly_recovery_bdt: 1000, recovered_bdt: 0, reason: 'Travel home', status: 'OPEN' },
  ]);

  // Last month's payroll, with Durga Puja bonus for the Hindu staff member; all but two paid.
  const slips = await computePayroll({ salary_month: prevMonth, bonus_label: 'Durga Puja bonus', bonus_percent: 100, bonus_staff_ids: [staffIds[5]], overtime_multiplier: 2 });
  let slipPaid = 0;
  for (const [i, s] of slips.entries()) {
    const { full_name, role, payment_method, wallet_or_account, attendance, ...slip } = s;
    const pay = i < slips.length - 2;
    await knex('staff_payslips').insert({ ...slip, status: pay ? 'PAID' : 'DRAFT', paid_on: pay ? addDays(`${thisMonth}-01`, Math.min(2, i % 3)) : null,
      payment_method: pay ? payment_method : null, payment_ref: pay && payment_method !== 'CASH' ? trx() : null });
    if (pay) {
      slipPaid++;
      let left_ = s.advance_recovery_bdt;
      for (const a of await knex('staff_advances').where({ id_staff: s.id_staff, status: 'OPEN' }).where('given_on', '<', `${thisMonth}-01`).orderBy('given_on')) {
        if (left_ <= 0) break;
        const take = Math.min(left_, Number(a.amount_bdt) - Number(a.recovered_bdt));
        const rec = round2(Number(a.recovered_bdt) + take);
        await knex('staff_advances').where({ id_staff_advances: a.id_staff_advances }).update({ recovered_bdt: rec, status: rec >= Number(a.amount_bdt) ? 'SETTLED' : 'OPEN' });
        left_ = round2(left_ - take);
      }
    }
  }

  // ── 4. Visitors, parking, notices ──────────────────────────────
  const now = Date.now();
  const at = hoursAgo => new Date(now - hoursAgo * 3600000);
  const V = [
    ['Foodpanda rider', 'DELIVERY', 'Foodpanda', 'DHAKA METRO-LA 21-4410', 0.3, null],
    ['Md. Arif (AC technician)', 'SERVICE', 'Walton Service', null, 1.2, null],
    ['Shamima Nasrin', 'GUEST', null, null, 0.8, null],
    ['Pathao driver', 'RIDE_SHARE', 'Pathao', 'DHAKA METRO-HA 14-2290', 0.1, null],
    ['Sundarban Courier', 'DELIVERY', 'Sundarban Courier', null, 3.5, 3.3],
    ['Rokeya Begum (maid)', 'DOMESTIC_HELP', null, null, 5, 2],
    ['DESCO meter reader', 'OFFICIAL', 'DESCO', null, 6, 5.6],
    ['Prof. Anisur Rahman', 'GUEST', null, 'DHAKA METRO-GA 33-1287', 8, 6],
    ['Chaldal delivery', 'DELIVERY', 'Chaldal', 'DHAKA METRO-NA 11-5521', 9, 8.8],
    ['Uber driver', 'RIDE_SHARE', 'Uber', 'DHAKA METRO-GA 27-9011', 20, 19.9],
    ['Md. Jamal (plumber)', 'SERVICE', null, null, 26, 24],
    ['Tahmina & family', 'GUEST', null, 'DHAKA METRO-KHA 12-8861', 28, 23],
    ['Daraz delivery', 'DELIVERY', 'Daraz', null, 30, 29.8],
    ['Titas Gas inspector', 'OFFICIAL', 'Titas Gas', null, 44, 43],
    ['Foodpanda rider', 'DELIVERY', 'Foodpanda', 'DHAKA METRO-LA 18-0032', 46, 45.9],
    ['Kamrul Hasan', 'GUEST', null, null, 50, 47],
    ['Steadfast Courier', 'DELIVERY', 'Steadfast', null, 52, 51.8],
    ['Interior designer team', 'SERVICE', 'Living Spaces Ltd', 'DHAKA METRO-THA 11-0098', 54, 49],
  ];
  const guards = ['Md. Rubel Mia', 'Md. Saiful Islam', 'Md. Abdul Malek'];
  await knex('visitor_logs').insert(V.map(([visitor_name, purpose, company, vehicle_no, inH, outH], i) => {
    const u = purpose === 'OFFICIAL' && i % 2 ? null : units[(i * 7) % units.length];
    return { visitor_name, purpose, company, vehicle_no, id_units: u?.id_units || null, people_count: visitor_name.includes('family') ? 4 : purpose === 'SERVICE' && i % 3 === 0 ? 2 : 1,
      phone: `01${pickOne(['7', '8', '9', '6', '5', '3'])}${String(10000000 + Math.floor(rand() * 89999999))}`, host_name: purpose === 'GUEST' || purpose === 'SERVICE' ? 'Resident (intercom)' : null,
      check_in: at(inH), check_out: outH == null ? null : at(outH), guard_name: guards[i % guards.length] };
  }));

  const slots = [];
  const plates = ['DHAKA METRO-GA 12-3456', 'DHAKA METRO-GA 27-1180', 'DHAKA METRO-KHA 11-0457', 'DHAKA METRO-GHA 13-7722', 'DHAKA METRO-GA 31-0086', 'DHAKA METRO-GA 19-6604',
    'DHAKA METRO-CHA 51-2203', 'DHAKA METRO-GA 22-9015', 'DHAKA METRO-GHA 15-3348', 'DHAKA METRO-GA 35-1172', 'DHAKA METRO-KHA 13-5520', 'DHAKA METRO-GA 28-4431',
    'DHAKA METRO-GA 14-7789', 'DHAKA METRO-GHA 11-2210', 'DHAKA METRO-GA 33-6612', 'DHAKA METRO-GA 26-0044', 'DHAKA METRO-KHA 14-8873', 'DHAKA METRO-GA 30-1199'];
  const models = ['Toyota Axio, white', 'Toyota Premio, silver', 'Honda Vezel, black', 'Toyota Noah, white', 'Toyota Allion, grey', 'Mitsubishi Pajero, black', 'Toyota Corolla Cross, white', 'Nissan X-Trail, silver'];
  for (let i = 1; i <= 30; i++) {
    const code = `B1-${pad(i)}`;
    if (i <= 18) slots.push({ slot_code: code, location: 'Basement-1', slot_type: 'CAR', id_units: units[(i * 5) % units.length].id_units, vehicle_no: plates[i - 1], vehicle_model: models[i % models.length], monthly_fee_bdt: 1500, status: 'ALLOCATED' });
    else if (i <= 20) slots.push({ slot_code: code, location: 'Basement-1', slot_type: 'CAR', id_units: units[(i * 5) % units.length].id_units, monthly_fee_bdt: 1500, status: 'RESERVED', notes: 'Booked by owner — car arriving next month' });
    else if (i === 21) slots.push({ slot_code: code, location: 'Basement-1', slot_type: 'CAR', monthly_fee_bdt: 1500, status: 'BLOCKED', notes: 'Water seepage — repair pending' });
    else slots.push({ slot_code: code, location: 'Basement-1', slot_type: 'CAR', monthly_fee_bdt: 1500, status: 'FREE' });
  }
  for (let i = 1; i <= 12; i++) {
    slots.push(i <= 6
      ? { slot_code: `M-${pad(i)}`, location: 'Ground floor (east)', slot_type: 'MOTORBIKE', id_units: units[(i * 11) % units.length].id_units, vehicle_no: `DHAKA METRO-LA ${pad(10 + i)}-${String(1000 + i * 731).slice(-4)}`, vehicle_model: pickOne(['Yamaha FZ-S', 'Bajaj Pulsar 150', 'Honda Hornet', 'Suzuki Gixxer']), monthly_fee_bdt: 500, status: 'ALLOCATED' }
      : { slot_code: `M-${pad(i)}`, location: 'Ground floor (east)', slot_type: 'MOTORBIKE', monthly_fee_bdt: 500, status: 'FREE' });
  }
  for (let i = 1; i <= 4; i++) slots.push({ slot_code: `V-${pad(i)}`, location: 'Ground floor (gate side)', slot_type: 'VISITOR', monthly_fee_bdt: 0, status: 'FREE' });
  await knex('parking_slots').insert(slots);

  await knex('notices').insert([
    { title_en: 'Lift 2 maintenance on Friday', title_bn: 'শুক্রবার লিফট ২ রক্ষণাবেক্ষণ', category: 'MAINTENANCE', is_pinned: true, publish_date: addDays(today, -1), expiry_date: addDays(today, 4),
      body_en: 'Lift 2 (Tower A) will be off on Friday from 10 am to 1 pm for its quarterly AMC service. Please use Lift 1 during this time.', body_bn: 'ত্রৈমাসিক এএমসি সার্ভিসের জন্য শুক্রবার সকাল ১০টা থেকে দুপুর ১টা পর্যন্ত লিফট ২ (টাওয়ার এ) বন্ধ থাকবে। এ সময় লিফট ১ ব্যবহার করুন।' },
    { title_en: 'Annual General Meeting of the owners’ association', title_bn: 'মালিক সমিতির বার্ষিক সাধারণ সভা', category: 'MEETING', is_pinned: true, publish_date: addDays(today, -3), expiry_date: addDays(today, 18),
      body_en: 'The AGM will be held in the community hall at 4 pm on Saturday, three weeks from now. Agenda: audited accounts, new security agency contract, and the 2027 service charge rates. One representative per flat, please.', body_bn: 'আগামী তিন সপ্তাহ পরের শনিবার বিকেল ৪টায় কমিউনিটি হলে বার্ষিক সাধারণ সভা হবে। আলোচ্যসূচি: নিরীক্ষিত হিসাব, নতুন সিকিউরিটি এজেন্সির চুক্তি এবং ২০২৭ সালের সার্ভিস চার্জের হার। প্রতি ফ্ল্যাট থেকে একজন প্রতিনিধি উপস্থিত থাকুন।' },
    { title_en: 'Water supply off for tank cleaning', title_bn: 'ট্যাংক পরিষ্কারের জন্য পানি সরবরাহ বন্ধ', category: 'UTILITY_OUTAGE', publish_date: today, expiry_date: addDays(today, 2),
      body_en: 'The overhead water tanks will be cleaned tomorrow. Water will be off from 9 am to 3 pm. Please store enough water tonight.', body_bn: 'আগামীকাল ছাদের পানির ট্যাংক পরিষ্কার করা হবে। সকাল ৯টা থেকে বিকেল ৩টা পর্যন্ত পানি বন্ধ থাকবে। আজ রাতে প্রয়োজনীয় পানি সংরক্ষণ করুন।' },
    { title_en: `Service charge for ${new Date(`${thisMonth}-01T00:00:00`).toLocaleString('en-GB', { month: 'long' })} is due on the 10th`, title_bn: 'চলতি মাসের সার্ভিস চার্জ ১০ তারিখের মধ্যে পরিশোধ করুন', category: 'PAYMENT', publish_date: `${thisMonth}-01`, expiry_date: `${thisMonth}-10`,
      body_en: 'Bills are in the owner portal. You can pay by bKash, Nagad, Rocket or card from the portal, or in cash at the office. A Tk 100 late fee applies after the grace period.', body_bn: 'বিল মালিক পোর্টালে দেওয়া আছে। পোর্টাল থেকে বিকাশ, নগদ, রকেট বা কার্ডে, অথবা অফিসে নগদে পরিশোধ করা যাবে। নির্ধারিত সময়ের পর ১০০ টাকা বিলম্ব ফি প্রযোজ্য।' },
    { title_en: 'Visitors must register at the gate', title_bn: 'আগন্তুকদের গেটে নিবন্ধন বাধ্যতামূলক', category: 'SECURITY', publish_date: addDays(today, -12),
      body_en: 'For everyone’s safety, guards will call the flat on the intercom before letting any visitor or delivery person in. Please inform the gate in advance if you are expecting guests.', body_bn: 'সবার নিরাপত্তার জন্য কোনো আগন্তুক বা ডেলিভারি কর্মীকে প্রবেশের আগে প্রহরী ইন্টারকমে ফ্ল্যাটে ফোন করবেন। অতিথি আসার কথা থাকলে আগে থেকে গেটে জানিয়ে রাখুন।' },
    { title_en: 'Durga Puja greetings', title_bn: 'শারদীয় দুর্গাপূজার শুভেচ্ছা', category: 'GENERAL', publish_date: addDays(`${prevMonth}-01`, 15), expiry_date: addDays(`${prevMonth}-01`, 22),
      body_en: 'Warm Durga Puja greetings to all residents from the management committee.', body_bn: 'ব্যবস্থাপনা কমিটির পক্ষ থেকে সকল বাসিন্দাকে শারদীয় দুর্গাপূজার শুভেচ্ছা।' },
  ].map(n => ({ ...n, created_by: 'Kabir Hossain (Project Manager)' })));

  console.log(`Building operations seed: ${tenantCount} tenants, ${invCount} rent invoices, ${billCount} service charge bills (${scPaid} paid), ` +
    `${S.length + 1} staff, ${att.length} attendance marks, ${slips.length} payslips (${slipPaid} paid), ${V.length} visitors, ${slots.length} parking slots, 6 notices.`);
};
