extends Node

## Opens a core page of the Pixl Dashboard (config urls.site) in a new tab.
## Only the allowlisted paths below are reachable, with no query string or
## fragment, and nothing about the game's session is handed to the page: the
## dashboard has its own login.

const GAMEPLAY_SCENES := ["village", "open_world", "house_interior"]

const ALLOWED_PATHS := [
	"dashboard",
	"projects",
	"shop",
	"orders",
	"trials",
	"account",
	"report",
	"docs",
	"explore",
	"explore/leaderboard",
	"ideas",
	"show-n-tell",
	"calc",
	"vault",
	"collectibles",
	"refers",
]

# Browsers only allow window.open while the page has a recent user gesture.
# Godot handles input on its own frame rather than inside the DOM event, so
# when that activation has lapsed we show a tiny dialog whose link the player
# clicks themselves instead of silently getting nothing.
const _open_js := """(function(u){
	var ua = navigator.userActivation;
	if (!ua || ua.isActive) {
		window.open(u, '_blank', 'noopener,noreferrer');
		return;
	}
	var id = 'pixl-popup-fallback';
	var old = document.getElementById(id); if (old) old.remove();
	var wrap = document.createElement('div');
	wrap.id = id;
	wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);font-family:system-ui,-apple-system,sans-serif';
	var card = document.createElement('div');
	card.style.cssText = 'background:#16161d;color:#f4f4f5;border:1px solid #2a2a35;border-radius:16px;padding:26px 30px;max-width:340px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.55)';
	var msg = document.createElement('div');
	msg.textContent = 'Open this page in a new tab:';
	msg.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:8px';
	var shown = document.createElement('div');
	shown.textContent = u;
	shown.style.cssText = 'font-size:12px;opacity:.75;word-break:break-all;margin-bottom:18px';
	var link = document.createElement('a');
	link.href = u;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.textContent = 'OPEN';
	link.style.cssText = 'display:inline-block;text-decoration:none;cursor:pointer;border-radius:11px;padding:11px 26px;font-weight:700;font-size:14px;letter-spacing:.03em;background:#f4b942;color:#16161d';
	var close = function(){ wrap.remove(); document.removeEventListener('keydown', onKey); };
	var onKey = function(e){ if (e.key === 'Escape') close(); };
	link.onclick = function(){ setTimeout(close, 0); };
	wrap.onclick = function(e){ if (e.target === wrap) close(); };
	document.addEventListener('keydown', onKey);
	card.appendChild(msg); card.appendChild(shown); card.appendChild(link); wrap.appendChild(card);
	document.body.appendChild(wrap);
})(%s);"""

# Only a pending login nonce is the game's to drop here; the session itself
# lives in user://session.dat and NetworkManager.clear_session() removes it.
const _sign_out_js := """(function(){
	try { localStorage.removeItem('pixl_game_login_nonce'); } catch (e) {}
})();"""

func open(path: String) -> void:
	var url := build_url(path)
	if url == "":
		push_warning("[WebPages] refusing to open non-allowlisted page: " + path)
		return
	if OS.has_feature("web"):
		JavaScriptBridge.eval(_open_js % JSON.stringify(url), true)
	else:
		OS.shell_open(url)

func sign_out() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval(_sign_out_js, true)

## "https://pixl.hackclub.com/<path>" for an allowlisted path, else "".
func build_url(path: String) -> String:
	if not is_allowed(path):
		return ""
	return PixlConfig.url("site", "https://pixl.hackclub.com").trim_suffix("/") + "/" + path

static func is_allowed(path: String) -> bool:
	if ALLOWED_PATHS.has(path):
		return true
	# docs/<slug>: one lowercase segment, nothing else.
	if path.begins_with("docs/"):
		var slug := path.substr(5)
		if slug == "" or slug.length() > 64:
			return false
		for c in slug:
			if not ((c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "-"):
				return false
		return true
	# explore/players/<uuid>: a player's profile, the id strictly UUID-shaped.
	if path.begins_with("explore/players/"):
		return _is_uuid(path.substr(16))
	return false

static func _is_uuid(s: String) -> bool:
	if s.length() != 36:
		return false
	for i in s.length():
		var c := s[i]
		if i == 8 or i == 13 or i == 18 or i == 23:
			if c != "-":
				return false
		elif not ((c >= "a" and c <= "f") or (c >= "A" and c <= "F") or (c >= "0" and c <= "9")):
			return false
	return true

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
			open("trials")
		_:
			return
	get_viewport().set_input_as_handled()
