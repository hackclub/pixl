class_name SkinUtil
#
const PRESET_DIR := "res://assets/cozy-towns/CozyValley_Premium_1.3/Characters/-- Pre-assembled Characters/"
const BASE_DIR := "res://assets/cozy-towns/CozyValley_Basic_1.0/Characters/"
const PREMIUM_DIR := "res://assets/cozy-towns/CozyValley_Premium_1.3/Characters/"
const PREMIUM_HAIR_DIR := "res://assets/cozy-towns/CozyValley_Premium_1.3/Characters/Hairstyles/"
const NPC_DIR := "res://assets/npcs/"
const SHEET_SIZE := Vector2i(160, 576)

# Named skins reserved for NPCs, addressed as "npc:<name>" on an NPC node's
# `skin` export. Each value is a full 160x576 CozyValley-format sheet. These are
# deliberately NOT accepted by is_valid() and never listed in the character
# editor, so a player can never wear one, they're NPC-only.
const NPC_SHEETS := {
	"pixo": NPC_DIR + "pixo_char.png",
	"cheetah": NPC_DIR + "cheetah_char.png",
}

const PORTRAIT_REGION := Rect2(0, 32, 32, 32)

const NUM_BODY := 3
const NUM_HAIR := 18
const NUM_TOP := 18
const NUM_BOTTOM := 18
const NUM_PRESETS := 9

static func encode_outfit(body: int, hair: int, top: int, bottom: int) -> String:
	return "cv1:b%dh%dt%do%d" % [body, hair, top, bottom]

static func is_preset(desc: String) -> bool:
	return desc.begins_with("cvc:")

static func is_npc_skin(desc: String) -> bool:
	return desc.begins_with("npc:")

static func preset_index(desc: String) -> int:
	if is_preset(desc):
		return clampi(int(desc.substr(4)), 1, NUM_PRESETS)
	return 0

static func parse_outfit(desc: String) -> Dictionary:
	var re := RegEx.new()
	re.compile("^cv1:b([1-3])h(\\d{1,2})t(\\d{1,2})o(\\d{1,2})$")
	var m := re.search(desc)
	if m == null:
		return {"body": 1, "hair": 1, "top": 1, "bottom": 1}
	return {
		"body": int(m.get_string(1)),
		"hair": clampi(int(m.get_string(2)), 0, NUM_HAIR),
		"top": clampi(int(m.get_string(3)), 1, NUM_TOP),
		"bottom": clampi(int(m.get_string(4)), 1, NUM_BOTTOM),
	}

static func is_valid(desc: String) -> bool:
	var re := RegEx.new()
	re.compile("^(cvc:[1-9]|cv1:b[1-3]h(\\d|1[0-8])t([1-9]|1[0-8])o([1-9]|1[0-8]))$")
	return re.search(desc) != null

static func random_outfit() -> String:
	return encode_outfit(
		randi_range(1, NUM_BODY),
		randi_range(1, NUM_HAIR),
		randi_range(1, NUM_TOP),
		randi_range(1, NUM_BOTTOM),
	)

static func resolve_sheet(desc: String) -> Texture2D:
	if is_npc_skin(desc):
		var p: String = NPC_SHEETS.get(desc.substr(4), "")
		if p != "" and ResourceLoader.exists(p):
			return load(p)
		return load(PRESET_DIR + "char1.png")
	if is_preset(desc):
		return load(PRESET_DIR + "char%d.png" % preset_index(desc))
	if desc.begins_with("cv1:"):
		return _bake_outfit(parse_outfit(desc))
	return load(PRESET_DIR + "char1.png")

static func hair_path(n: int) -> String:
	if n <= 6:
		return BASE_DIR + "Hairstyles/Hairstyles_short_%d.png" % n
	if n <= 12:
		return PREMIUM_DIR + "Hairstyles/Hairstyles_ponytail_%d.png" % (n - 6)
	return PREMIUM_DIR + "Hairstyles/Hairstyles_middlePart_%d.png" % (n - 12)

static func top_path(n: int) -> String:
	if n <= 6:
		return BASE_DIR + "Tops/Tops_shirt_%d.png" % n
	if n <= 12:
		return PREMIUM_DIR + "Tops/Tops_hoodie_%d.png" % (n - 6)
	return PREMIUM_DIR + "Tops/Tops_striped_%d.png" % (n - 12)

static func bottom_path(n: int) -> String:
	if n <= 6:
		return BASE_DIR + "Bottoms/Bottoms_shorts_%d.png" % n
	if n <= 12:
		return PREMIUM_DIR + "Bottoms/Bottoms_long_%d.png" % (n - 6)
	return PREMIUM_DIR + "Bottoms/Bottoms_skirt_%d.png" % (n - 12)

static func bake_with_hair(desc: String, hair_file: String) -> Texture2D:
	var o := parse_outfit(desc)
	var paths: Array[String] = [
		BASE_DIR + "Base/Base%d_hand_back.png" % o.body,
		BASE_DIR + "Base/Base%d_body.png" % o.body,
		bottom_path(o.bottom),
		top_path(o.top),
		PREMIUM_HAIR_DIR + hair_file,
		BASE_DIR + "Base/Base%d_hand_front.png" % o.body,
	]
	return _blend(paths)

static func _bake_outfit(o: Dictionary) -> Texture2D:
	var paths: Array[String] = [
		BASE_DIR + "Base/Base%d_hand_back.png" % o.body,
		BASE_DIR + "Base/Base%d_body.png" % o.body,
		bottom_path(o.bottom),
		top_path(o.top),
	]
	if int(o.hair) > 0:
		paths.append(hair_path(o.hair))
	paths.append(BASE_DIR + "Base/Base%d_hand_front.png" % o.body)
	return _blend(paths)

static func _blend(paths: Array[String]) -> Texture2D:
	var result := Image.create_empty(SHEET_SIZE.x, SHEET_SIZE.y, false, Image.FORMAT_RGBA8)
	for p in paths:
		var tex := load(p) as Texture2D
		if tex == null:
			continue
		var img := tex.get_image()
		if img == null:
			continue
		if img.is_compressed():
			img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		result.blend_rect(img, Rect2i(Vector2i.ZERO, SHEET_SIZE), Vector2i.ZERO)
	return ImageTexture.create_from_image(result)

static func portrait(desc: String) -> AtlasTexture:
	var at := AtlasTexture.new()
	at.atlas = resolve_sheet(desc)
	at.region = PORTRAIT_REGION
	return at
