// supabase-config.js
// 這裡專門管理 Supabase 的連線資訊，方便前台與後台共用。

const SUPABASE_URL = 'https://gvysbmflwfidmifwepxz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2eXNibWZsd2ZpZG1pZndlcHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyNzM4OTEsImV4cCI6MjEwNDg0OTg5MX0.7W8fBnbmZ6nOWpZohPvo_zCprZ7Ef0jvbG11iJrywrU';

// 初始化 Supabase Client 並掛載到全域 window 物件，讓其他 JS 檔案也能直接使用 _supabase
window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 定義共用的課節名稱對照表
window.LESSON_NAMES = { 1: '第 1 節', 2: '第 2 節', 3: '第 3 節', 4: '第 4 節', 5: '第 5 節', 6: '第 6 節', 7: '放學' };
