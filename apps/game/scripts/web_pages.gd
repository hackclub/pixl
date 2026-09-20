extends Node

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]
# same-origin only
const _open_js := """(function(u, t){
	try {
		if (t && new URL(u, location.href).origin === location.origin) localStorage.setItem('pixl_token', t);
	} catch (e) {}
	var w = window.open(u, 'pixl_web');
	if (w) { window.__pixlWeb = w; return; }
	var id = 'pixl-popup-fallback';
	var old = document.getElementById(id); if (old) old.remove();
	var wrap = document.createElement('div');
	wrap.id = id;
	wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);font-family:system-ui,-apple-system,sans-serif';
	var card = document.createElement('div');
	card.style.cssText = 'background:#16161d;color:#f4f4f5;border:1px solid #2a2a35;border-radius:16px;padding:26px 30px;max-width:320px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.55)';
	var msg = document.createElement('div');
	msg.textContent = 'Your browser blocked the pop-up. Tap to open it.';
	msg.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:18px';
	var btn = document.createElement('button');
	btn.textContent = 'OPEN';
	btn.style.cssText = 'cursor:pointer;border:0;border-radius:11px;padding:11px 26px;font-weight:700;font-size:14px;letter-spacing:.03em;background:#f4b942;color:#16161d';
	var close = function(){ wrap.remove(); document.removeEventListener('keydown', onKey); };
	var onKey = function(e){ if (e.key === 'Escape') close(); };
	btn.onclick = function(){ var w2 = window.open(u, 'pixl_web'); if (w2) window.__pixlWeb = w2; close(); };
	wrap.onclick = function(e){ if (e.target === wrap) close(); };
	document.addEventListener('keydown', onKey);
	card.appendChild(msg); card.appendChild(btn); wrap.appendChild(card);
	document.body.appendChild(wrap);
})(%s, %s);"""

# The companion pages keep their own copy of the session in localStorage, so a
# logout in the game has to knock it out too or the dashboard stays signed in.
# When the game runs on the apex the pages share our origin and the removal is
# enough (other tabs pick it up through the storage event); on the play.* host
# they don't, so we also poke the window we opened.
const _sign_out_js := """(function(){
	try {
		localStorage.removeItem('pixl_token');
		localStorage.removeItem('pixl_tour_step');
		localStorage.removeItem('pixl_onboarded');
	} catch (e) {}
	var w = window.__pixlWeb;
	if (w && !w.closed) { try { w.postMessage({ pixl: 'logout' }, '*'); } catch (e) {} }
})();"""

func open(path: String) -> void:
	var url := _build_url(path)
	if OS.has_feature("web"):
		JavaScriptBridge.eval(_open_js % [JSON.stringify(url), JSON.stringify(NetworkManager.session_token)], true)
	else:
		OS.shell_open(url)

func sign_out() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval(_sign_out_js, true)

func _build_url(path: String) -> String:
	# path may carry its own query and/or fragment, e.g.
	# "projects?from=game&trial=101#foo". Split both off so the base stays a clean
	# path segment and the caller's query is merged after embed (rather than
	# jammed into the path before the trailing slash).
	var base := path
	var fragment := ""
	var query := ""
	var hash_pos := base.find("#")
	if hash_pos != -1:
		fragment = base.substr(hash_pos)
		base = base.substr(0, hash_pos)
	var q_pos := base.find("?")
	if q_pos != -1:
		query = base.substr(q_pos + 1)
		base = base.substr(0, q_pos)
	var url := _web_base() + "/" + base + "/?embed=1"
	if query != "":
		url += "&" + query
	url += fragment
	return url

# Base origin for the companion pages. In a web build this is the origin the
# game is loaded from (so pixl.rsvp/play → pixl.rsvp), with the play.* subdomain
# folded onto the apex. Native builds fall back to the configured site.
func _web_base() -> String:
	if OS.has_feature("web"):
		var origin = JavaScriptBridge.eval("location.origin", true)
		if typeof(origin) == TYPE_STRING and String(origin).begins_with("http"):
			return String(origin).replace("//play.pixl.rsvp", "//pixl.rsvp")
	return PixlConfig.url("site", "https://pixl.hackclub.com")

func _in_gameplay() -> bool:
	var cur := get_tree().current_scene
	return cur != null and GAMEPLAY_SCENES.has(cur.scene_file_path.get_file().get_basename())

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	if not _in_gameplay() or global.ui_blocked() or ChatHud.is_typing() or Dialogue.is_open:
		return
	match event.keycode:
		KEY_H:
			open("projects")
		KEY_B:
			open("shop")
		KEY_J:
			open("quests")
		_:
			return
	get_viewport().set_input_as_handled()
