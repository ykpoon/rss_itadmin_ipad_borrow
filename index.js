// index.js
// 學校 iPad & 設備借用預約系統 - 前台邏輯控制

// 💡 從 window 物件中取得共用的 Supabase Client 與課節對照表
const _supabase = window._supabase;
const LESSON_NAMES = window.LESSON_NAMES;

let currentUser = null;
let isCurrentUserAdmin = false;

let totalStock = { iPad: 150, Mobile: 55 };
let dailyAdjustments = []; // 存放特定日期特別設定的物資總量
let monthlyAdjustments = []; // 儲存當月所有的每日庫存調節資料
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

let currentBookings = [];
let teachersList = [];
let calendarDate = new Date(); // 紀錄月曆當前顯示的年月
let monthlyBookings = [];      // 儲存當月所有的借用記錄以便統計

// ================= 1. 初始化與事件監聽 =================
document.addEventListener('DOMContentLoaded', async () => {
  const dateInput = document.getElementById('selectDate');
  if (dateInput) {
    dateInput.value = getTodayString();
    dateInput.addEventListener('change', fetchAndRender);
  }

  // 看板專屬小日曆與快速切換按鈕監聽
  const dashDatePicker = document.getElementById('dashboard-date-picker');
  const dashPrevBtn = document.getElementById('dashboard-prev-day');
  const dashNextBtn = document.getElementById('dashboard-next-day');

  function formatDateToYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getSelectedDateObj() {
    const val = (dateInput && dateInput.value) || getTodayString();
    return new Date(val.replace(/-/g, '/'));
  }

  function changeSelectedDate(newDateStr) {
    if (dateInput) dateInput.value = newDateStr;
    if (dashDatePicker) dashDatePicker.value = newDateStr;
    fetchAndRender();
  }

  if (dashDatePicker && dateInput) {
    dashDatePicker.value = dateInput.value;
    dashDatePicker.addEventListener('change', (e) => {
      const selected = e.target.value;
      if (selected) changeSelectedDate(selected);
    });
  }

  if (dashPrevBtn) {
    dashPrevBtn.addEventListener('click', () => {
      const current = getSelectedDateObj();
      current.setDate(current.getDate() - 1);
      changeSelectedDate(formatDateToYYYYMMDD(current));
    });
  }

  if (dashNextBtn) {
    dashNextBtn.addEventListener('click', () => {
      const current = getSelectedDateObj();
      current.setDate(current.getDate() + 1);
      changeSelectedDate(formatDateToYYYYMMDD(current));
    });
  }

  if (dateInput && dashDatePicker) {
    dateInput.addEventListener('change', () => {
      dashDatePicker.value = dateInput.value;
    });
  }

  // 執行資料載入與認證
  try {
    await checkAuth();
    await loadResources(); 
    await loadTeachers();  
    await fetchMonthlyData(); // 載入當月月曆數據
    await fetchAndRender();
    setupRealtime();
  } catch (err) {
    console.error("初始化載入失敗:", err);
  }
});

function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatDateWithWeekday(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${dateStr} (${WEEKDAY_NAMES[d.getDay()]})`;
}

// ================= 2. 身分認證與權限控制 =================
async function checkIsAdminFromDB(email) {
  if (!email || !_supabase) return false;
  try {
    const { data, error } = await _supabase
      .from('admins')
      .select('email')
      .ilike('email', email.trim());
    return !error && data && data.length > 0;
  } catch (e) {
    console.warn("查詢 admins 表出錯:", e);
    return false;
  }
}

async function checkAuth() {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    await updateAuthUI(session?.user || null);

    return new Promise((resolve) => {
      _supabase.auth.onAuthStateChange(async (_event, session) => {
        await updateAuthUI(session?.user || null);
        renderTable(); 
        resolve();
      });
      resolve();
    });
  } catch (e) {
    console.error("Auth 初始化錯誤:", e);
  }
}

async function updateAuthUI(user) {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const emailDisplay = document.getElementById('userEmailDisplay');
  const adminBadge = document.getElementById('adminBadge');
  const adminPortalBtn = document.getElementById('adminPortalBtn');
  const loginAlert = document.getElementById('loginRequiredAlert');

  currentUser = user;

  if (user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
    if (emailDisplay) emailDisplay.textContent = user.email;
    if (loginAlert) loginAlert.classList.add('hidden');

    isCurrentUserAdmin = await checkIsAdminFromDB(user.email);
    if (isCurrentUserAdmin) {
      if (adminBadge) adminBadge.classList.remove('hidden');
      if (adminPortalBtn) adminPortalBtn.classList.remove('hidden');
    } else {
      if (adminBadge) adminBadge.classList.add('hidden');
      if (adminPortalBtn) adminPortalBtn.classList.add('hidden');
    }
  } else {
    isCurrentUserAdmin = false;
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (adminPortalBtn) adminPortalBtn.classList.add('hidden');
    if (loginAlert) loginAlert.classList.remove('hidden');
  }
}

// 綁定給全域按鈕使用的認證函數
window.loginWithGoogle = async function() {
  try {
    const { error } = await _supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: { prompt: 'select_account' },
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) alert('登入失敗：' + error.message);
  } catch (e) {
    alert('無法啟動 Google 登入視窗！');
  }
};

window.logout = async function() {
  await _supabase.auth.signOut();
  location.reload();
};

// ================= 3. 資料載入 (庫存與教師) =================
async function loadResources() {
  try {
    const { data, error } = await _supabase.from('resources').select('name, total_qty');
    if (error) throw error;

    if (data && data.length > 0) {
      data.forEach(item => {
        if (item.name === 'iPad') totalStock.iPad = item.total_qty;
        if (item.name === 'Mobile') totalStock.Mobile = item.total_qty;
      });
    }
  } catch (e) {
    console.warn("❌ 載入資源庫存出錯:", e.message);
  }

  const subtitleEl = document.getElementById('totalStockSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `全校總量基準：iPad ${totalStock.iPad} 部 ｜ Mobile ${totalStock.Mobile} 部`;
  }
  
  renderDashboard();
  updateRemainingPreview();
}

async function loadTeachers() {
  const selectedDateInput = document.getElementById('selectDate');
  const queryDateStr = selectedDateInput ? selectedDateInput.value : getTodayString();

  try {
    const { data, error } = await _supabase
      .from('teachers')
      .select('name, is_suspended, suspended_until, missed_count');

    if (!error && data && data.length > 0) {
      teachersList = data.sort((a, b) => a.name.localeCompare(b.name, 'zh-HK'));
    }
  } catch (e) {
    console.warn("載入教師名單出錯", e);
  }

  const select = document.getElementById('teacherSelect');
  if (select) {
    select.innerHTML = '<option value="" disabled selected>請選擇老師姓名...</option>';
    
    teachersList.forEach(teacher => {
      const option = document.createElement('option');
      option.value = teacher.name;

      let currentlySuspended = false;
      if (teacher.is_suspended) {
        if (teacher.suspended_until) {
          if (queryDateStr <= teacher.suspended_until) {
            currentlySuspended = true;
          }
        } else {
          currentlySuspended = true;
        }
      }

      if (currentlySuspended) {
        const until = teacher.suspended_until ? `至 ${teacher.suspended_until}` : '';
        option.textContent = `⛔ ${teacher.name} (暫停借用 ${until})`;
        option.disabled = true;
        option.classList.add('text-rose-500');
      } else {
        option.textContent = teacher.name;
      }
      select.appendChild(option);
    });
  }

  renderFrontTeachersTable();
}

function renderFrontTeachersTable() {
  const tbody = document.getElementById('frontTeachersTableBody');
  const badge = document.getElementById('frontSuspendedCount');
  if (!tbody) return;

  tbody.innerHTML = '';

  const sorted = [...teachersList].sort((a, b) => 
    (b.is_suspended - a.is_suspended) || (b.missed_count - a.missed_count)
  );

  if (badge) badge.textContent = `${sorted.filter(t => t.is_suspended).length} 位停借中`;

  sorted.forEach(t => {
    const tr = document.createElement('tr');
    tr.className = t.is_suspended ? "bg-rose-50/40" : "hover:bg-slate-50";
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-800">${t.name}</td>
      <td class="py-3 px-4 font-bold ${t.missed_count > 0 ? 'text-rose-600' : 'text-slate-500'}">
        ${t.missed_count || 0} 次
      </td>
      <td class="py-3 px-4">
        ${t.is_suspended ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded font-bold">⛔ 暫停借用中</span>' : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">正常</span>'}
      </td>
      <td class="py-3 px-4 font-mono text-slate-500 text-[11px]">${t.suspended_until || '--'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ================= 4. 實時事件監聽 (Realtime) =================
function setupRealtime() {
  _supabase
    .channel('public:bookings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
      fetchAndRender();
      fetchMonthlyData();
    })
    .subscribe();

  _supabase
    .channel('public:teachers')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teachers' }, () => {
      loadTeachers();
    })
    .subscribe();

  _supabase
    .channel('public:resources')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'resources' }, async () => {
      await loadResources();
    })
    .subscribe();

  _supabase
    .channel('public:admins')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, async () => {
      if (currentUser) await updateAuthUI(currentUser);
    })
    .subscribe();

  _supabase
    .channel('public:daily_adjustments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_adjustments' }, () => {
      fetchAndRender();
      fetchMonthlyData();
    })
    .subscribe();
}

// ================= 5. 計算庫存與狀態渲染 =================
async function fetchAndRender() {
  const selectDateEl = document.getElementById('selectDate');
  if (!selectDateEl) return;
  const selectedDate = selectDateEl.value;
  const displaySelectedDateEl = document.getElementById('displaySelectedDate');
  if (displaySelectedDateEl) displaySelectedDateEl.textContent = formatDateWithWeekday(selectedDate);

  try {
    const { data: bookingsData, error: err1 } = await _supabase
      .from('bookings')
      .select('*')
      .eq('date', selectedDate);

    if (!err1 && bookingsData) {
      currentBookings = bookingsData;
    }

    const { data: adjustData, error: err2 } = await _supabase
      .from('daily_adjustments')
      .select('*')
      .eq('date', selectedDate);

    if (!err2 && adjustData) {
      dailyAdjustments = adjustData;
    } else {
      dailyAdjustments = [];
    }

  } catch (e) {
    console.warn("讀取預約或調節數據出錯", e);
  }

  renderDashboard();
  renderTable();
  updateRemainingPreview();
  loadTeachers(); 
}

function getRemainingStock(lesson, device) {
  const borrowed = currentBookings
    .filter(b => b.lesson === parseInt(lesson) && b.device_type === device && b.status !== 'waiting' && b.status !== 'returned')
    .reduce((sum, b) => sum + b.quantity, 0);

  const specialOverride = dailyAdjustments.find(a => a.device_type === device);
  const total = specialOverride ? specialOverride.available_qty : (totalStock[device] || 0);

  return Math.max(0, total - borrowed);
}

window.updateRemainingPreview = function() {
  const lessonEl = document.getElementById('lessonSelect');
  const deviceTypeEl = document.getElementById('deviceType');
  if (!lessonEl || !deviceTypeEl) return;

  const lesson = lessonEl.value;
  const device = deviceTypeEl.value;
  const remaining = getRemainingStock(lesson, device);

  const stockBadgeEl = document.getElementById('stockBadge');
  if (stockBadgeEl) stockBadgeEl.textContent = `(尚餘: ${remaining} 部)`;
  
  const qtyInput = document.getElementById('quantity');
  if (qtyInput) {
    if (remaining > 0) {
      qtyInput.max = remaining;
    } else {
      qtyInput.removeAttribute('max');
    }
  }
};

window.switchFrontTab = function(sectionId) {
  document.querySelectorAll('.tab-section-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('border-indigo-600', 'text-indigo-600', 'font-bold');
    el.classList.add('border-transparent', 'text-slate-500');
  });

  const sectionEl = document.getElementById(sectionId);
  if (sectionEl) sectionEl.classList.remove('hidden');

  const activeBtn = document.getElementById(`tabBtn-${sectionId.replace('-section', '')}`);
  if (activeBtn) {
    activeBtn.classList.add('border-indigo-600', 'text-indigo-600', 'font-bold');
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
  }
};

// ================= 6. 視覺化月曆邏輯 =================
window.changeMonth = async function(offset) {
  calendarDate.setMonth(calendarDate.getMonth() + offset);
  await fetchMonthlyData();
};

async function fetchMonthlyData() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  
  const firstDayStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const titleEl = document.getElementById('calendarMonthTitle');
  if (titleEl) titleEl.textContent = `${year} 年 ${String(month + 1).padStart(2, '0')} 月`;

  try {
    const { data: bookings, error: err1 } = await _supabase
      .from('bookings')
      .select('*')
      .gte('date', firstDayStr)
      .lte('date', lastDayStr);

    if (!err1 && bookings) {
      monthlyBookings = bookings;
    }

    const { data: adjusts, error: err2 } = await _supabase
      .from('daily_adjustments')
      .select('*')
      .gte('date', firstDayStr)
      .lte('date', lastDayStr);

    if (!err2 && adjusts) {
      monthlyAdjustments = adjusts;
    } else {
      monthlyAdjustments = [];
    }

  } catch (e) {
    console.warn("載入月曆數據失敗", e);
  }
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('div');
    empty.className = "bg-slate-50 border border-slate-100 rounded-lg p-2 h-44 opacity-35";
    grid.appendChild(empty);
  }

  const LESSON_SHORTS = { 1: '第 1 節', 2: '第 2 節', 3: '第 3 節', 4: '第 4 節', 5: '第 5 節', 6: '第 6 節', 7: '放學' };

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayBookings = monthlyBookings.filter(b => b.date === dateStr && b.status !== 'returned' && !(b.remarks && b.remarks.includes('[候補]')));

    const card = document.createElement('div');
    card.onclick = () => {
      const selectDateEl = document.getElementById('selectDate');
      if (selectDateEl) {
        selectDateEl.value = dateStr;
        const event = new Event('change');
        selectDateEl.dispatchEvent(event);
      }
      switchFrontTab('booking-section');
    };

    const isSelected = (document.getElementById('selectDate').value === dateStr);
    card.className = `border rounded-lg p-2.5 h-44 flex flex-col justify-between cursor-pointer transition hover:border-indigo-500 hover:shadow-md ${isSelected ? 'ring-2 ring-indigo-600 border-transparent bg-indigo-50/30' : 'bg-white border-slate-200'}`;

    let lessonsListHTML = '';

    for (let l = 1; l <= 7; l++) {
      const ipadBorrowed = dayBookings.filter(b => b.lesson === l && b.device_type === 'iPad').reduce((sum, b) => sum + b.quantity, 0);
      const mobileBorrowed = dayBookings.filter(b => b.lesson === l && b.device_type === 'Mobile').reduce((sum, b) => sum + b.quantity, 0);

      const dayIpadAdjust = monthlyAdjustments.find(a => a.date === dateStr && a.device_type === 'iPad');
      const dayMobileAdjust = monthlyAdjustments.find(a => a.date === dateStr && a.device_type === 'Mobile');

      const currentDayIpadTotal = dayIpadAdjust ? dayIpadAdjust.available_qty : totalStock.iPad;
      const currentDayMobileTotal = dayMobileAdjust ? dayMobileAdjust.available_qty : totalStock.Mobile;

      const ipadRem = Math.max(0, currentDayIpadTotal - ipadBorrowed);
      const mobileRem = Math.max(0, currentDayMobileTotal - mobileBorrowed);

      const ipadColor = ipadRem > 30 ? 'text-emerald-600 font-semibold' : (ipadRem > 0 ? 'text-amber-500 font-bold' : 'text-rose-500 font-bold');
      const mobileColor = mobileRem > 15 ? 'text-emerald-600 font-semibold' : (mobileRem > 0 ? 'text-amber-500 font-bold' : 'text-rose-500 font-bold');

      lessonsListHTML += `
        <div class="flex items-center justify-between py-0.5 border-b border-slate-100/50 last:border-0 text-[10px]">
          <span class="font-extrabold text-slate-500 mr-1">${LESSON_SHORTS[l]}</span>
          <div class="flex items-center space-x-1.5">
            <span class="${ipadColor}" title="iPad 尚餘">iPad: ${ipadRem}</span>
            <span class="${mobileColor}" title="Mobile 尚餘">Mobile: ${mobileRem}</span>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex justify-between items-center pb-1 border-b border-slate-100">
        <span class="text-xs font-black ${isSelected ? 'text-indigo-700' : 'text-slate-700'}">${day} 日</span>
        <span class="text-[9px] text-slate-400 font-medium">剩餘可借用數目</span>
      </div>
      <div class="flex-1 py-1 flex flex-col justify-center">
        ${lessonsListHTML}
      </div>
    `;
    grid.appendChild(card);
  }
}

// ================= index.js 中的 renderDashboard 函數美化 =================
function renderDashboard() {
  const grid = document.getElementById('lessonsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let l = 1; l <= 7; l++) {
    const remIpad = getRemainingStock(l, 'iPad');
    const remMobile = getRemainingStock(l, 'Mobile');

    // 💡 科技感深色半透明與微發光設計
    const ipadColor = remIpad > 30 
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-sm shadow-emerald-500/5' 
      : (remIpad > 0 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-sm shadow-amber-500/5' : 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-sm shadow-rose-500/5');
    
    const mobileColor = remMobile > 15 
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-sm shadow-emerald-500/5' 
      : (remMobile > 0 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-sm shadow-amber-500/5' : 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-sm shadow-rose-500/5');

    const specialIpadOverride = dailyAdjustments.find(a => a.device_type === 'iPad');
    const specialMobileOverride = dailyAdjustments.find(a => a.device_type === 'Mobile');
    const ipadTotal = specialIpadOverride ? specialIpadOverride.available_qty : totalStock.iPad;
    const mobileTotal = specialMobileOverride ? specialMobileOverride.available_qty : totalStock.Mobile;

    const card = document.createElement('div');
    card.className = "bg-slate-950/60 border border-slate-800 hover:border-teal-500/40 rounded-2xl p-4 flex flex-col justify-between shadow-lg transition-all duration-300 transform hover:-translate-y-1 glow-effect";
    card.innerHTML = `
      <div class="text-xs font-bold text-slate-200 mb-2 pb-1.5 border-b border-slate-800/60 flex justify-between items-center font-mono">
        <span>${LESSON_NAMES[l]}</span>
        <span class="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-md shadow-teal-400/50"></span>
      </div>
      <div class="space-y-2 text-[11px] font-semibold">
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-xl border ${ipadColor}">
          <span class="font-bold">iPad</span>
          <span class="font-mono">${remIpad} / ${ipadTotal}</span>
        </div>
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-xl border ${mobileColor}">
          <span class="font-bold">Mobile</span>
          <span class="font-mono">${remMobile} / ${mobileTotal}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
}


// ================= 7. 渲染當日借用詳情清單 =================
function renderTable() {
  const tbody = document.getElementById('bookingsTableBody');
  const emptyMsg = document.getElementById('emptyMessage');
  const countBadge = document.getElementById('recordCount');
  if (!tbody) return;

  countBadge.textContent = `共 ${currentBookings.length} 筆記錄`;
  tbody.innerHTML = '';

  if (currentBookings.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    return;
  }
  if (emptyMsg) emptyMsg.classList.add('hidden');

  const activeBookings = [];
  const waitingBookings = [];

  currentBookings.forEach(item => {
    const isWaiting = (item.remarks && item.remarks.includes('[候補]')) || item.status === 'waiting';
    if (isWaiting) {
      waitingBookings.push(item);
    } else {
      activeBookings.push(item);
    }
  });

  activeBookings.sort((a, b) => a.lesson - b.lesson);
  waitingBookings.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const finalSortedList = [...activeBookings, ...waitingBookings];
  const waitingCounters = {};

  finalSortedList.forEach(item => {
    const isOwner = currentUser && (item.user_email && currentUser.email === item.user_email);
    const canDelete = isCurrentUserAdmin || isOwner;
    const isWaiting = (item.remarks && item.remarks.includes('[候補]')) || item.status === 'waiting';

    let waitingBadgeHTML = '';
    if (isWaiting) {
      const key = `${item.lesson}_${item.device_type}`;
      waitingCounters[key] = (waitingCounters[key] || 0) + 1;
      const waitOrder = waitingCounters[key];

      waitingBadgeHTML = `
        <span class="ml-1 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded-sm font-bold border border-amber-600 animate-pulse">
          候補 ${waitOrder}
        </span>
      `;
    }

    const tr = document.createElement('tr');
    tr.className = isWaiting ? "bg-amber-50/40 hover:bg-amber-50/70 transition" : "hover:bg-slate-50/80 transition";
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-semibold text-slate-800">
        ${LESSON_NAMES[item.lesson]}
        ${isWaiting ? '<span class="block text-[10px] text-amber-600 font-bold">(候補隊列)</span>' : ''}
      </td>
      <td class="py-2.5 px-3 font-medium text-indigo-700">${item.teacher_name}</td>
      <td class="py-2.5 px-3 text-slate-700 font-semibold">
        <span class="${item.device_type === 'iPad' ? 'text-blue-600' : 'text-purple-600'}">
          ${item.device_type} × ${item.quantity}
        </span>
        ${waitingBadgeHTML}
      </td>
      <td class="py-2.5 px-3">${item.class} (${item.subject})</td>
      <td class="py-2.5 px-3">${item.room}</td>
      <td class="py-2.5 px-3 text-center">
        ${canDelete ? `
          <button onclick="deleteBooking('${item.id}', '${item.teacher_name}')" class="text-rose-500 hover:text-rose-700 p-1 transition" title="取消登記">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        ` : `
          <span class="text-slate-300 text-[11px] cursor-not-allowed" title="非本人登記，無權取消">
            <i class="fa-solid fa-lock"></i>
          </span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ================= 8. 提交借用表單 =================
window.handleFormSubmit = async function(event) {
  event.preventDefault();

  if (!currentUser) {
    alert('請先點擊右上角使用學校 Google 帳號登入後再進行借用！');
    loginWithGoogle();
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在儲存...';
  }

  const date = document.getElementById('selectDate').value;
  const lesson = parseInt(document.getElementById('lessonSelect').value);
  const teacher_name = document.getElementById('teacherSelect').value;
  const device_type = document.getElementById('deviceType').value;
  const quantity = parseInt(document.getElementById('quantity').value);
  const className = document.getElementById('className').value;
  const subject = document.getElementById('subject').value;
  const room = document.getElementById('room').value;
  const remarks = document.getElementById('remarks').value.trim();

  if (!teacher_name) {
    alert('請先選擇借用老師！');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 確認提交借用登記';
    }
    return;
  }

  const teacherRecord = teachersList.find(t => t.name === teacher_name);
  let isTeacherCurrentlySuspended = false;

  if (teacherRecord && teacherRecord.is_suspended) {
    if (teacherRecord.suspended_until) {
      if (date <= teacherRecord.suspended_until) {
        isTeacherCurrentlySuspended = true;
      }
    } else {
      isTeacherCurrentlySuspended = true;
    }
  }

  if (isTeacherCurrentlySuspended) {
    const until = teacherRecord.suspended_until ? `至 ${teacherRecord.suspended_until}` : '';
    alert(`❌ 借用失敗：${teacher_name} 老師在 ${date} 當天仍處於停止借用期 (${until})！`);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 確認提交借用登記';
    }
    return;
  }

  const remaining = getRemainingStock(lesson, device_type);
  let isWaiting = false;

  if (quantity > remaining) {
    const confirmWait = confirm(`⚠️ 該節 ${device_type} 剩餘庫存為 ${remaining} 部（不足 ${quantity} 部）。\n\n您是否要將此預約排入【候補名單 (Waiting List)】？\n若當天有同事未前來取機，將依候補順序為您安排。`);
    
    if (confirmWait) {
      isWaiting = true;
    } else {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 確認提交借用登記';
      }
      return;
    }
  }

  if (_supabase) {
    const bookingStatus = isWaiting ? 'waiting' : 'pending';
    
    const { error } = await _supabase.from('bookings').insert([{
      date, 
      lesson, 
      teacher_name, 
      device_type, 
      quantity, 
      class: className, 
      subject, 
      room, 
      remarks: isWaiting ? `[候補] ${remarks}`.trim() : remarks, 
      status: bookingStatus, 
      user_email: currentUser.email
    }]);

    if (error) {
      alert('登記失敗：' + error.message);
    } else {
      if (isWaiting) {
        alert(`📝 已成功為您排入候補！當前狀態為：【候補中】。`);
      } else {
        alert(`✅ 借用成功！已為 ${teacher_name} 登記 ${LESSON_NAMES[lesson]} 的 ${device_type} (${quantity} 部)。`);
      }
      document.getElementById('bookingForm').reset();
      fetchAndRender();
    }
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 確認提交借用登記';
  }
};

// ================= 9. 取消借用 =================
window.deleteBooking = async function(id, teacherName) {
  if (!currentUser) {
    alert('請先登入！');
    return;
  }

  if (!confirm(`確定要取消 ${teacherName} 的此筆借用記錄嗎？釋出的數量將即時回補。`)) return;

  if (_supabase) {
    const { error } = await _supabase.from('bookings').delete().eq('id', id);
    if (error) {
      alert('刪除失敗：' + error.message);
    } else {
      fetchAndRender();
    }
  }
};
