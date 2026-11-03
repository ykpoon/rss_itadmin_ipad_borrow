// Isolated browser fixture: no real account, bookings, or Supabase requests.
(() => {
  const users = {
    a: { id: 'teacher-a', email: 'a@example.invalid' },
    b: { id: 'teacher-b', email: 'b@example.invalid' }
  };
  let user = users[localStorage.getItem('reminder-test-user') || 'a'] || null;
  let authCallback;
  const db = {
    admins: [],
    teachers: [
      { id: 'a', name: 'Teacher A', email: users.a.email },
      { id: 'alias', name: 'Teacher A alias', email: users.a.email },
      { id: 'b', name: 'Teacher B', email: users.b.email }
    ],
    resources: [{ name: 'iPad', total_qty: 150 }, { name: 'Mobile', total_qty: 55 }],
    daily_adjustments: [],
    bookings: [
      { id: 'mine', teacher_name: 'Teacher A', date: '2026-11-03', lesson: 1, quantity: 12, class: '1A', device_type: 'iPad', status: 'pending', usage_type: 'basic' },
      { id: 'alias', teacher_name: 'Teacher A alias', date: '2026-11-04', lesson: 2, quantity: 5, class: '2A', device_type: 'Mobile', status: 'waiting', usage_type: 'basic' },
      { id: 'other', teacher_name: 'Teacher B', date: '2026-11-05', lesson: 3, quantity: 8, class: '3B', device_type: 'iPad', status: 'pending', usage_type: 'interactive' },
      { id: 'outside-week', teacher_name: 'Teacher A', date: '2026-11-12', lesson: 1, quantity: 99, class: '4A', device_type: 'iPad', status: 'pending', usage_type: 'basic' }
    ]
  };
  window.reminderTestDB = db;
  window.reminderTestReads = 0;
  function from(table) {
    let filters = [], offset = 0, end = Infinity;
    const q = {
      select() { return q; }, order() { return q; },
      eq(k, v) { filters.push(b => b[k] === v); return q; },
      ilike(k, v) { filters.push(b => String(b[k]).toLowerCase() === v.toLowerCase()); return q; },
      gte(k, v) { filters.push(b => b[k] >= v); return q; },
      lte(k, v) { filters.push(b => b[k] <= v); return q; },
      in(k, values) { filters.push(b => values.includes(b[k])); return q; },
      range(a, b) { offset = a; end = b; return q; },
      then(resolve, reject) {
        window.reminderTestReads++;
        return Promise.resolve({ data: structuredClone(db[table].filter(b => filters.every(f => f(b))).slice(offset, end + 1)), error: null }).then(resolve, reject);
      }
    };
    return q;
  }
  const session = () => user ? { user } : null;
  window.emitReminderTestAuth = (event, key) => {
    user = users[key] || null;
    localStorage.setItem('reminder-test-user', key || 'none');
    authCallback(event, session());
  };
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  const client = {
    from, channel: () => channel,
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange(callback) {
        authCallback = callback;
        setTimeout(() => callback('INITIAL_SESSION', session()), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  window.supabase = { createClient: () => client };
})();
