extends RefCounted

const _begin_js := """(function(){
	try {
		var ttl = 10 * 60 * 1000;
		var bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		var nonce = Array.from(bytes, function(b){ return b.toString(16).padStart(2, '0'); }).join('');
		localStorage.setItem('pixl_game_login_nonce', nonce + '.' + (Date.now() + ttl));
		return nonce;
	} catch (e) { return ''; }
})()"""

const _take_js := """(function(){
	var out = '';
	var token = '', name = '', ln = '', isNew = false;
	try {
		var u = new URL(location.href);
		var p = u.searchParams;
		token = p.get('token') || '';
		name = p.get('name') || '';
		ln = p.get('ln') || '';
		isNew = p.get('new') === '1';
		var dirty = false;
		['token', 'name', 'new', 'ln'].forEach(function(k){ if (p.has(k)) { p.delete(k); dirty = true; } });
		if (dirty) history.replaceState({}, document.title, u.pathname + u.search + u.hash);
	} catch (e) {}
	try {
		var stored = (localStorage.getItem('pixl_game_login_nonce') || '').split('.');
		if (token && stored[0] && Number(stored[1]) > Date.now() && ln === stored[0]) {
			localStorage.removeItem('pixl_game_login_nonce');
			out = JSON.stringify({ token: token, name: name, isNew: isNew });
		}
	} catch (e) {}
	return out;
})()"""

static func begin() -> String:
	var nonce = JavaScriptBridge.eval(_begin_js, true)
	return String(nonce) if typeof(nonce) == TYPE_STRING else ""

static func take() -> Dictionary:
	var raw = JavaScriptBridge.eval(_take_js, true)
	if typeof(raw) != TYPE_STRING or String(raw) == "":
		return {}
	var parsed = JSON.parse_string(String(raw))
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}
