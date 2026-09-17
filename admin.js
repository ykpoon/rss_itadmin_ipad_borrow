// admin.js
// IT 管理員後台 - 設備借用與黑名單管理邏輯控制

// 💡 從 window 物件中取得共用的 Supabase Client 與課節對照表
const _supabase = window._supabase;
const LESSON_NAMES = window.LESSON_NAMES;

let currentAdminUser = null;

// ================= 1. 初始化與生命週期 (安全載入) =================
document.addEventListener('DOMContentLoaded', async () => {
  const dateInput = document.getElementById('adminQueryDate');
  if (dateInput) {
    dateInput.value = getTodayString();
    dateInput.addEventListener('change', loadAdminBookings);
  }

  // 1. 在背景默默執行管理員認證身分
  try {
    await verifyAdminAuth();

    // 🌟 即時監聽 Google OAuth 跳轉完成
    _supabase.auth.onAuthStateChange(async (event, session) => {
      await verifyAdminAuth();
    });
  } catch (err) {
    console.error("後台認證初始化失敗:", err);
  }

  // 2. 💡 獨立控制動畫：保證在剛好 1.5 秒 (1500ms) 後淡出遮罩，絕對不卡死！
  setTimeout(() => {
    const loader = document.getElementById('app-loader');
    if (loader) {
      loader.classList.add('opacity-0', '-translate-y-full');
      setTimeout(() => {
        loader.classList.add('hidden');
      }, 700);
    }
  }, 900);
});

function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// ================= 2. 權限驗證邏輯 =================
async function verifyAdminAuth() {
  if (!_supabase) return;

  const { data: { session } } = await _supabase.auth.getSession();
  currentAdminUser = session?.user || null;

  const adminEmailDisplay = document.getElementById('adminEmailDisplay');
  const accessDeniedBlock = document.getElementById('accessDeniedBlock');
  const adminMainContent = document.getElementById('adminMainContent');

  let isAdmin = false;
  if (currentAdminUser && currentAdminUser.email) {
    try {
      const { data, error } = await _supabase
        .from('admins')
        .select('email')
        .ilike('email', currentAdminUser.email.trim());
      isAdmin = !error && data && data.length > 0;
    } catch (e) {
      console.error("查詢 admins 出錯:", e);
    }
  }

  if (isAdmin) {
    if (adminEmailDisplay) adminEmailDisplay.textContent = currentAdminUser.email;
    if (accessDeniedBlock) accessDeniedBlock.classList.add('hidden');
    if (adminMainContent) adminMainContent.classList.remove('hidden');

    // 💡 呼叫下方宣告的標準函數
    loadAdminBookings();
    loadAdminTeachers();
    loadAdminResources();
    loadDailyAdjustments();
  } else {
    if (adminEmailDisplay) adminEmailDisplay.textContent = currentAdminUser ? currentAdminUser.email : '未登入';
    if (accessDeniedBlock) accessDeniedBlock.classList.remove('hidden');
    if (adminMainContent) adminMainContent.classList.add('hidden');
  }
}

// 認證相關
async function loginWithGoogle() {
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { prompt: 'select_account' },
      redirectTo: window.location.href
    }
  });
  if (error) alert('登入失敗：' + error.message);
}

async function logout() {
  await _supabase.auth.signOut();
  location.reload();
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.remove('border-indigo-600', 'text-indigo-600', 'font-bold');
    el.classList.add('border-transparent', 'text-slate-500');
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove('hidden');
  
  const activeBtn = document.getElementById(`tabBtn-${tabId.replace('tab-', '')}`);
  if (activeBtn) {
    activeBtn.classList.add('border-indigo-600', 'text-indigo-600', 'font-bold');
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
  }
}

// ================= 3. 借還審核控制 =================
// ================= admin.js 中的 loadAdminBookings 函數 (已修正：新增備註欄與候補成功徽章) =================
async function loadAdminBookings() {
  const dateInput = document.getElementById('adminQueryDate');
  if (!dateInput) return;
  const selectedDate = dateInput.value;

  const { data, error } = await _supabase
    .from('bookings')
    .select('*')
    .eq('date', selectedDate)
    .order('lesson', { ascending: true });

  const tbody = document.getElementById('adminBookingsTable');
  const emptyMsg = document.getElementById('adminEmptyBookings');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error || !data || data.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    updateStatusCounters([]);
    return;
  }
  if (emptyMsg) emptyMsg.classList.add('hidden');
  updateStatusCounters(data);

  data.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition";

    let statusBadge = '<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">待取機</span>';
    if (item.status === 'borrowed') statusBadge = '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold">已借出</span>';
    if (item.status === 'returned') statusBadge = '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">已歸還</span>';
    if (item.status === 'missed') statusBadge = '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-semibold">欠取機</span>';
    if (item.status === 'waiting') statusBadge = '<span class="px-2 py-0.5 bg-yellow-400 text-yellow-950 rounded font-bold animate-pulse">候補中 (Wait)</span>';

    // 💡 1. 檢查這筆預約是否為「候補成功」
    const isPromoted = item.remarks && item.remarks.includes('[候補成功]');
    let promotedBadgeHTML = '';
    if (isPromoted) {
      promotedBadgeHTML = `
        <span class="block mt-1 w-fit px-1.5 py-0.5 bg-teal-500 text-white text-[10px] rounded font-extrabold border border-teal-600 animate-pulse tracking-wider">
          候補遞補
        </span>
      `;
    }

    // 💡 2. 過濾備註中的 [候補成功] 和 [候補] 技術性文字，保持介面最乾淨
    let cleanRemarksDisplay = item.remarks || '';
    cleanRemarksDisplay = cleanRemarksDisplay.replace('[候補成功]', '').replace('[候補]', '').trim();
    if (!cleanRemarksDisplay) {
      cleanRemarksDisplay = '<span class="text-slate-300">--</span>';
    }

    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-slate-800">${LESSON_NAMES[item.lesson]}</td>
      <td class="py-3 px-4 font-semibold text-indigo-700">${item.teacher_name}</td>
      <td class="py-3 px-4 font-bold">
        ${item.device_type} × ${item.quantity}
        ${promotedBadgeHTML} <!-- 💡 在設備下方顯示候補遞補徽章 -->
      </td>
      <td class="py-3 px-4">${item.class} · ${item.subject} (${item.room})</td>
      <td class="py-3 px-4 text-slate-400 font-mono text-[11px]">${item.user_email || '無記錄'}</td>
      <td class="py-3 px-4 text-slate-600 font-medium text-xs max-w-[150px] truncate" title="${item.remarks || ''}">${cleanRemarksDisplay}</td> <!-- 💡 新增：備註 TD 欄位 -->
      <td class="py-3 px-4">${statusBadge}</td>
      <td class="py-3 px-4 text-center space-x-1">
        <button onclick="updateBookingStatus('${item.id}', 'borrowed')" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded font-medium transition" title="確認借出（候補扶正）">
          <i class="fa-solid fa-box-open"></i> 已取
        </button>
        <button onclick="updateBookingStatus('${item.id}', 'returned')" class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded font-medium transition" title="標記為已歸還">
          <i class="fa-solid fa-circle-check"></i> 歸還
        </button>
        <button onclick="markAsMissed('${item.id}', '${item.teacher_name}')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-medium transition" title="標記為欠取">
          <i class="fa-solid fa-triangle-exclamation"></i> 欠取
        </button>
        <button onclick="deleteBookingAdmin('${item.id}')" class="p-1 text-slate-400 hover:text-rose-600 transition" title="強制刪除此記錄">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}


function updateStatusCounters(list) {
  const pendingEl = document.getElementById('countPending');
  const borrowedEl = document.getElementById('countBorrowed');
  const returnedEl = document.getElementById('countReturned');
  const missedEl = document.getElementById('countMissed');

  if (pendingEl) pendingEl.textContent = list.filter(i => i.status === 'pending').length;
  if (borrowedEl) borrowedEl.textContent = list.filter(i => i.status === 'borrowed').length;
  if (returnedEl) returnedEl.textContent = list.filter(i => i.status === 'returned').length;
  if (missedEl) missedEl.textContent = list.filter(i => i.status === 'missed').length;
  
  const waitEl = document.getElementById('countWaiting');
  if (waitEl) waitEl.textContent = list.filter(i => i.status === 'waiting').length;
}

async function updateBookingStatus(bookingId, status) {
  await _supabase.from('bookings').update({ status }).eq('id', bookingId);
  loadAdminBookings();
}

async function markAsMissed(bookingId, teacherName) {
  if (!confirm(`確定要將 ${teacherName} 的此筆記錄標記為「欠取機」嗎？\n系統將自動為該老師累加 1 次欠取次數！`)) return;

  await _supabase.from('bookings').update({ status: 'missed' }).eq('id', bookingId);

  const { data: teacher } = await _supabase.from('teachers').select('missed_count').eq('name', teacherName).single();

  if (teacher) {
    const newCount = (teacher.missed_count || 0) + 1;
    const autoSuspend = newCount >= 2;
    await _supabase.from('teachers').update({ missed_count: newCount, is_suspended: autoSuspend ? true : undefined }).eq('name', teacherName);
    alert(`已標記為欠取！${teacherName} 老師累計欠取次數更新為 ${newCount} 次。` + (autoSuspend ? '\n⚠️ 該老師欠取滿 2 次，已自動加入停借名單！' : ''));
  }

  loadAdminBookings();
  loadAdminTeachers();
}

async function deleteBookingAdmin(id) {
  if (!confirm('管理員確定要強制刪除此借用記錄嗎？')) return;
  await _supabase.from('bookings').delete().eq('id', id);
  loadAdminBookings();
}

// ================= 4. 教師欠取與黑名單管理 =================
// ================= admin.js 中的 loadAdminTeachers 函數 (已優化：預覽教師電郵) =================
async function loadAdminTeachers() {
  const { data } = await _supabase.from('teachers').select('*');
  const tbody = document.getElementById('adminTeachersTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data) return;

  data.sort((a, b) => (b.is_suspended - a.is_suspended) || (b.missed_count - a.missed_count));

  const suspendedTotal = data.filter(t => t.is_suspended).length;
  const suspendedCountEl = document.getElementById('suspendedCount');
  if (suspendedCountEl) suspendedCountEl.textContent = `${suspendedTotal} 位停借中`;

  data.forEach(t => {
    const tr = document.createElement('tr');
    tr.className = t.is_suspended ? "bg-rose-50/40" : "hover:bg-slate-50";
    tr.innerHTML = `
      <td class="py-2.5 px-3">
        <span class="font-semibold text-slate-800">${t.name}</span>
        <!-- 💡 新增：在後台名字下方預覽電郵 -->
        <span class="block text-[10px] text-slate-400 font-mono mt-0.5">${t.email || '未設定電郵'}</span>
      </td>
      <td class="py-2.5 px-3 font-bold ${t.missed_count > 0 ? 'text-rose-600' : 'text-slate-500'}">${t.missed_count || 0} 次</td>
      <td class="py-2.5 px-3">${t.is_suspended ? '<span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded font-bold">⛔ 暫停借用中</span>' : '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">正常</span>'}</td>
      <td class="py-2.5 px-3 font-mono text-[11px]">${t.suspended_until || '--'}</td>
      <td class="py-2.5 px-3 text-center space-x-1">
        ${t.is_suspended ? `
          <button onclick="toggleTeacherSuspend('${t.name}', false)" class="px-2 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded font-medium transition text-xs">
            <i class="fa-solid fa-lock-open mr-1"></i> 解除停借
          </button>
        ` : `
          <button onclick="promptSuspend('${t.name}')" class="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 border border-rose-300 rounded font-medium transition text-xs">
            <i class="fa-solid fa-ban mr-1"></i> 設為停借
          </button>
        `}
        <button onclick="resetMissedCount('${t.name}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition text-xs">清零</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleTeacherSuspend(teacherName, isSuspended, untilDate = null) {
  await _supabase.from('teachers').update({ is_suspended: isSuspended, suspended_until: untilDate }).eq('name', teacherName);
  loadAdminTeachers();
}

function promptSuspend(teacherName) {
  const untilDate = prompt(`請輸入 ${teacherName} 的停借截止日期 (格式: YYYY-MM-DD)：`, '');
  toggleTeacherSuspend(teacherName, true, untilDate || null);
}

async function resetMissedCount(teacherName) {
  if (!confirm(`確定要將 ${teacherName} 的欠取次數重設為 0 次嗎？`)) return;
  await _supabase.from('teachers').update({ missed_count: 0 }).eq('name', teacherName);
  loadAdminTeachers();
}

// ================= admin.js 中的 addNewTeacher 函數 (已優化：同時儲存教師電郵) =================
async function addNewTeacher(event) {
  event.preventDefault();
  const name = document.getElementById('newTeacherName').value.trim();
  const email = document.getElementById('newTeacherEmail').value.trim(); // 💡 讀取電郵
  if (!name || !email) return;

  const { error } = await _supabase.from('teachers').insert([{ name, email, missed_count: 0, is_suspended: false }]);
  if (error) alert('新增失敗：' + error.message);
  else {
    alert(`✅ 已成功新增 ${name} 老師 (${email})！`);
    document.getElementById('newTeacherName').value = '';
    document.getElementById('newTeacherEmail').value = '';
    loadAdminTeachers();
  }
}

// ================= 5. 全校基準物資總數設定 =================
async function loadAdminResources() {
  try {
    const { data, error } = await _supabase.from('resources').select('name, total_qty');
    if (!error && data) {
      data.forEach(item => {
        if (item.name === 'iPad') {
          const el = document.getElementById('adminIpadStock');
          if (el) el.value = item.total_qty;
        }
        if (item.name === 'Mobile') {
          const el = document.getElementById('adminMobileStock');
          if (el) el.value = item.total_qty;
        }
      });
    }
  } catch (err) {
    console.error("載入資源基準總數失敗:", err);
  }
}

async function updateResourcesStock(event) {
  event.preventDefault();
  
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 正在套用更新...';

  const ipadVal = parseInt(document.getElementById('adminIpadStock').value);
  const mobileVal = parseInt(document.getElementById('adminMobileStock').value);

  try {
    const { data: data1, error: error1 } = await _supabase
      .from('resources')
      .update({ total_qty: ipadVal })
      .eq('name', 'iPad')
      .select();

    const { data: data2, error: error2 } = await _supabase
      .from('resources')
      .update({ total_qty: mobileVal })
      .eq('name', 'Mobile')
      .select();

    if (error1 || error2) {
      throw new Error(error1?.message || error2?.message || "更新失敗，請檢查 RLS Policy 權限");
    }

    if (!data1?.length || !data2?.length) {
      throw new Error("更新成功，但資料庫未受影響（請檢查資源表中是否存在 'iPad' 和 'Mobile'）");
    }

    alert('✅ 全校物資總量已成功更新！前台已即時同步套用新上限。');
  } catch (err) {
    console.error("更新庫存出錯:", err);
    alert('❌ 儲存失敗：' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

// ================= 6. 每日特定日期數量調節邏輯 =================
async function loadDailyAdjustments() {
  const { data, error } = await _supabase
    .from('daily_adjustments')
    .select('*')
    .order('date', { ascending: true });

  const tbody = document.getElementById('dailyAdjustmentsTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400 font-bold">目前暫無任何特別日期調整</td></tr>`;
    return;
  }

  data.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition border-b";
    tr.innerHTML = `
      <td class="py-2 px-2 font-semibold">${item.date}</td>
      <td class="py-2 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${item.device_type === 'iPad' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}">${item.device_type}</span></td>
      <td class="py-2 px-2 font-bold text-amber-600">${item.available_qty} 部</td>
      <td class="py-2 px-2 text-slate-500">${item.reason || '--'}</td>
      <td class="py-2 px-2 text-center">
        <button onclick="deleteDailyAdjustment('${item.id}')" class="text-rose-500 hover:text-rose-700 transition" title="還原至預設基準">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveDailyAdjustment(event) {
  event.preventDefault();
  const date = document.getElementById('adjustDate').value;
  const device_type = document.getElementById('adjustDevice').value;
  const available_qty = parseInt(document.getElementById('adjustQty').value);
  const reason = document.getElementById('adjustReason').value.trim();

  if (!date) return;

  const { error } = await _supabase
    .from('daily_adjustments')
    .upsert({ date, device_type, available_qty, reason }, { onConflict: 'date,device_type' });

  if (error) {
    alert('設定失敗：' + error.message);
  } else {
    alert(`✅ 已成功將 ${date} 的 ${device_type} 可借用總量調整為 ${available_qty} 部！`);
    document.getElementById('adjustQty').value = '';
    document.getElementById('adjustReason').value = '';
    loadDailyAdjustments();
  }
}

async function deleteDailyAdjustment(id) {
  if (!confirm('確定要還原此特定日期的庫存設定，使其恢復為全校預設基準總量嗎？')) return;
  await _supabase.from('daily_adjustments').delete().eq('id', id);
  loadDailyAdjustments();
}

// ================= 7. 💡 統一將函數掛載給 Window，供 HTML 內 onclick 按鈕呼叫 =================
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.switchTab = switchTab;
window.loadAdminBookings = loadAdminBookings;
window.updateBookingStatus = updateBookingStatus;
window.markAsMissed = markAsMissed;
window.deleteBookingAdmin = deleteBookingAdmin;
window.loadAdminTeachers = loadAdminTeachers;
window.toggleTeacherSuspend = toggleTeacherSuspend;
window.promptSuspend = promptSuspend;
window.resetMissedCount = resetMissedCount;
window.addNewTeacher = addNewTeacher;
window.loadAdminResources = loadAdminResources;
window.updateResourcesStock = updateResourcesStock;
window.loadDailyAdjustments = loadDailyAdjustments;
window.saveDailyAdjustment = saveDailyAdjustment;
window.deleteDailyAdjustment = deleteDailyAdjustment;
