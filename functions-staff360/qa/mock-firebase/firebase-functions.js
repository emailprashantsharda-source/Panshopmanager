export const getFunctions = () => ({});
export const httpsCallable = (f, name) => async (data) => {
  const r = await fetch('/__call/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': localStorage.getItem('mock_user') || '' }, body: JSON.stringify(data || {}) });
  const j = await r.json();
  if (j.error) { const e = new Error(j.error.message); e.code = 'functions/' + j.error.code; throw e; }
  return { data: j.data };
};
