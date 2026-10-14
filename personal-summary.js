// 共用資料庫 Preview 的個人查閱分頁，不修改預約。
(function () {
  'use strict';
  const statuses = {
    pending: ['待取機', 'amber'], borrowed: ['已取機', 'blue'],
    returned: ['已歸還', 'green'], missed: ['欠取機', 'rose'],
    waiting: ['候補中', 'orange']
  };
  let bookings = [], requestVersion = 0;
  const byId = id => document.getElementById(id);
  const isVisible = () => !byId('personal-section')?.classList.contains('hidden');
  const emailKey = value => String(value || '').trim().toLowerCase();
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function buildSection() {
    if (window.IPAD_ENV?.features?.personal === false) {
      byId('tabBtn-personal').classList.add('hidden'); return;
    }
    const style = document.createElement('style');
    style.textContent = `
      .personal-summary{padding:24px;border-radius:16px;color:#334155}
      .personal-summary.hidden{display:none}
      .personal-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .personal-heading h2{font-size:22px;font-weight:800;color:#0f766e;margin:0 0 6px}
      .personal-heading p{font-size:14px;margin:0;color:#64748b}
      .personal-summary button{border:1px solid #cbd5e1;border-radius:10px;padding:9px 14px;background:#fff;font-weight:700;color:#0f766e;cursor:pointer}
      .personal-summary button:hover{background:#f0fdfa}
      .personal-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:24px 0}
      .personal-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px}
      .personal-card span{display:block;color:#64748b;font-size:13px}
      .personal-card strong{display:block;font-size:26px;margin-top:4px;color:#0f766e}
      .personal-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:16px;background:#f8fafc;border-radius:12px}
      .personal-filters label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;flex:1 1 150px}
      .personal-filters input,.personal-filters select{background:white;border:1px solid #cbd5e1;border-radius:8px;padding:9px;color:#334155;min-width:0;width:100%;font-weight:400}
      .personal-message{padding:12px 0;font-size:14px;color:#64748b;min-height:44px}
      .personal-table-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}
      .personal-table{width:100%;min-width:890px;border-collapse:collapse;font-size:14px;text-align:left}
      .personal-table th{background:#f0fdfa;color:#0f766e;padding:13px 12px;white-space:nowrap}
      .personal-table td{padding:14px 12px;border-top:1px solid #e2e8f0;vertical-align:top}
      .personal-table tbody tr:hover{background:#f8fafc}
      .personal-date{white-space:nowrap;font-weight:700}
      .personal-weekday{display:block;font-size:12px;color:#64748b;font-weight:400;margin-top:3px}
      .personal-badge{display:inline-block;white-space:nowrap;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:700;background:#f1f5f9;color:#475569}
      .personal-badge.amber{background:#fef3c7;color:#92400e}.personal-badge.blue{background:#dbeafe;color:#1e40af}
      .personal-badge.green{background:#d1fae5;color:#065f46}.personal-badge.rose{background:#ffe4e6;color:#9f1239}
      .personal-badge.orange{background:#ffedd5;color:#9a3412}
      .personal-note{max-width:250px;white-space:pre-wrap;overflow-wrap:anywhere}
      .personal-empty{text-align:center;color:#64748b;padding:36px!important}
      @media(max-width:900px){.personal-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:500px){.personal-summary{padding:16px}.personal-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.personal-card{padding:12px}.personal-heading h2{font-size:20px}}
    `;
    document.head.append(style);
    const section = document.createElement('section');
    section.id = 'personal-section';
    section.className = 'tab-section-content hidden tech-card personal-summary';
    section.setAttribute('aria-labelledby', 'personal-title');
    section.innerHTML = `
      <div class="personal-heading">
        <div><h2 id="personal-title">我的借用總表</h2>
          <p>查閱自己的借用安排及取還機狀況；管理員代為登記的借用亦會列出。</p>
          <p id="personal-identity" style="margin-top:8px;font-weight:700"></p>
        </div>
        <button type="button" id="personal-refresh">重新整理</button>
      </div>
      <div id="personal-cards" class="personal-cards" aria-label="所有個人借用記錄統計"></div>
      <div class="personal-filters">
        <label>日期範圍<select id="personal-range">
          <option value="all">全部日期</option><option value="week">本週</option>
          <option value="month">本月</option><option value="upcoming">今天及以後</option>
          <option value="custom">自訂日期</option>
        </select></label>
        <label>開始日期<input type="date" id="personal-start"></label>
        <label>結束日期<input type="date" id="personal-end"></label>
        <label>借用狀態<select id="personal-status"><option value="all">全部狀態</option>
          ${Object.entries(statuses).map(([value,[label]]) => `<option value="${value}">${label}</option>`).join('')}
        </select></label>
        <label>設備<select id="personal-device"><option value="all">全部設備</option>
          <option value="iPad">iPad</option><option value="Mobile">手機</option>
        </select></label>
        <button type="button" id="personal-reset">重設篩選</button>
      </div>
      <p id="personal-message" class="personal-message" role="status" aria-live="polite"></p>
      <div class="personal-table-wrap" tabindex="0" aria-label="個人借用總表，可左右捲動">
        <table class="personal-table"><thead><tr>
          <th scope="col">借用日期</th><th scope="col">課節</th><th scope="col">設備</th><th scope="col">數量</th>
          <th scope="col">班別</th><th scope="col">科目／用途</th><th scope="col">地點</th><th scope="col">狀態</th><th scope="col">備註</th>
        </tr></thead><tbody id="personal-rows"></tbody></table>
      </div>
      <p style="margin-top:12px;font-size:12px;color:#64748b">上方統計涵蓋所有個人記錄；下方總表按篩選結果顯示。每個日期及課節各佔一筆。此頁只供查閱。</p>
    `;
    document.querySelector('main').append(section);
    byId('personal-refresh').addEventListener('click', refresh);
    byId('personal-range').addEventListener('change', applyRange);
    ['personal-start','personal-end'].forEach(id => byId(id).addEventListener('change', () => {
      byId('personal-range').value = 'custom'; renderRows();
    }));
    ['personal-status','personal-device'].forEach(id => byId(id).addEventListener('change', renderRows));
    byId('personal-reset').addEventListener('click', () => {
      byId('personal-range').value = 'all'; byId('personal-status').value = 'all';
      byId('personal-device').value = 'all'; applyRange();
    });
    renderCards(); emptyRows('請先登入，再查看自己的借用記錄。');
  }
  function applyRange() {
    const range = byId('personal-range').value, now = new Date();
    let start = '', end = '';
    if (range === 'week') {
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay()+6)%7));
      start = dateKey(monday); monday.setDate(monday.getDate()+6); end = dateKey(monday);
    } else if (range === 'month') {
      start = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
      end = dateKey(new Date(now.getFullYear(), now.getMonth()+1, 0));
    } else if (range === 'upcoming') start = dateKey(now);
    else if (range === 'custom') { renderRows(); return; }
    byId('personal-start').value = start; byId('personal-end').value = end; renderRows();
  }
  function renderCards() {
    const cards = byId('personal-cards'); cards.replaceChildren();
    [['all',['全部記錄']], ...Object.entries(statuses)].forEach(([key,[label]]) => {
      const card = document.createElement('div'); card.className = 'personal-card';
      const title = document.createElement('span'); title.textContent = label;
      const count = document.createElement('strong'); count.dataset.status = key;
      count.textContent = key === 'all' ? bookings.length : bookings.filter(b => b.status === key).length;
      card.append(title,count); cards.append(card);
    });
  }
  function emptyRows(message) {
    const cell = document.createElement('td'); cell.colSpan = 9;
    cell.className = 'personal-empty'; cell.textContent = message;
    const row = document.createElement('tr'); row.append(cell); byId('personal-rows').replaceChildren(row);
  }
  function renderRows() {
    if (!currentUser?.email) {
      byId('personal-message').textContent = '登入後只會列出本人借用記錄。';
      emptyRows('請先登入，再查看自己的借用記錄。'); return;
    }
    const start = byId('personal-start').value, end = byId('personal-end').value;
    if (start && end && start > end) {
      byId('personal-message').textContent = '開始日期不能遲於結束日期。'; emptyRows('請調整日期範圍。'); return;
    }
    const status = byId('personal-status').value, device = byId('personal-device').value;
    const filtered = bookings.filter(b => (!start || b.date >= start) && (!end || b.date <= end)
      && (status === 'all' || b.status === status) && (device === 'all' || b.device_type === device));
    byId('personal-message').textContent = `顯示 ${filtered.length} 筆／個人記錄共 ${bookings.length} 筆，按日期及課節排列。`;
    if (!filtered.length) { emptyRows(bookings.length ? '此篩選條件沒有借用記錄。' : '你暫時沒有借用記錄。'); return; }
    const body = byId('personal-rows'); body.replaceChildren();
    filtered.forEach(b => {
      const row = document.createElement('tr'); row.dataset.bookingId = b.id;
      const [label,color] = statuses[b.status] || ['未識別狀態',''];
      const values = [b.date, LESSON_NAMES[b.lesson] || `第 ${b.lesson} 節`,
        b.device_type === 'Mobile' ? '手機' : b.device_type, `${b.quantity} 部`,
        b.class || '—', b.subject || b.usage_type || '—', b.room || '—', label, b.remarks || '—'];
      values.forEach((value, index) => {
        const cell = document.createElement('td'); cell.textContent = value;
        if (index === 0) {
          cell.className = 'personal-date'; const weekday = document.createElement('span'); weekday.className = 'personal-weekday';
          weekday.textContent = WEEKDAY_NAMES[new Date(b.date+'T12:00:00').getDay()] || ''; cell.append(weekday);
        } else if (index === 7) {
          cell.replaceChildren(); const badge = document.createElement('span');
          badge.className = `personal-badge ${color}`; badge.textContent = label; cell.append(badge);
        } else if (index === 8) cell.className = 'personal-note';
        row.append(cell);
      });
      body.append(row);
    });
  }
  async function refresh() {
    if (!byId('personal-section')) return;
    const version = ++requestVersion, userEmail = emailKey(currentUser?.email);
    bookings = []; renderCards();
    if (!userEmail) {
      byId('personal-identity').textContent = '尚未登入'; renderRows(); return;
    }
    byId('personal-identity').textContent = currentUser.email;
    emptyRows('正在載入個人借用記錄…'); byId('personal-message').textContent = '正在載入…';
    try {
      const {data:teachers,error:teacherError} = await _supabase.from('teachers').select('name,email');
      if (teacherError) throw Error(teacherError.message);
      const matching = teachers.filter(t => emailKey(t.email) === userEmail);
      const rows = await window.ipadLoadPersonalBookings();
      if (version !== requestVersion || emailKey(currentUser?.email) !== userEmail) return;
      bookings = rows.sort((a,b) => String(a.date).localeCompare(String(b.date)) || Number(a.lesson)-Number(b.lesson)
        || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      byId('personal-identity').textContent = `${matching.map(t=>t.name).join('、') || '未配對教師'} · ${currentUser.email}`;
      renderCards(); renderRows();
      if (!matching.length) {
        byId('personal-message').textContent = '此帳號未能在教師名單中配對，請聯絡管理員核對電郵。';
      }
    } catch (error) {
      if (version !== requestVersion) return;
      bookings = []; renderCards(); emptyRows('未能載入記錄，請按「重新整理」再試。');
      byId('personal-message').textContent = '載入失敗：'+error.message;
    }
  }
  window.previewRefreshPersonal = refresh;
  window.previewPersonalAuthChanged = () => {
    ++requestVersion; bookings = [];
    if (!byId('personal-section')) return;
    renderCards(); emptyRows('請先登入，再查看自己的借用記錄。');
    byId('personal-identity').textContent = currentUser?.email || '尚未登入';
    if (isVisible()) refresh();
  };
  window.addEventListener('preview:data-change', () => { if (isVisible()) refresh(); });
  window.addEventListener('focus', () => { if (isVisible()) refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isVisible()) refresh(); });
  document.addEventListener('DOMContentLoaded', buildSection);
})();
