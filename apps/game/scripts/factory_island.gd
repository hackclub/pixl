extends "res://scripts/multiplayer_world.gd"

# Factory Island's NPCs are rows in the `npcs` table (world "factory_island"),
# authored from the dashboard's Trials & NPCs page like every other world's.
# This is the only thing the scene does on load: the terrain is baked in the
# .tscn, so all it needs is its NPCs spawned.

func _ready() -> void:
	super._ready()
	await spawn_world_npcs()
