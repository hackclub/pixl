extends SceneTree
# Headless unit test for npc.gd's Trial picker. Run:
#   godot --headless --path . --script res://tests/test_trial_pick.gd
#
# A Trial-giver used to dead-end on its one linked Trial: once that Trial was
# completed, the NPC showed the completion line forever and never offered the
# follow-up Trials assigned to the same giver (e.g. Ridit's "Claim Your Stake").

var _fail := 0

func _initialize() -> void:
	_run()

func check(cond: bool, msg: String) -> void:
	if cond:
		print("  ok  ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

func quest(id: int, name: String, npc: String, npc_name: String, completed := false, unlocked := false) -> Dictionary:
	return {
		"id": id,
		"name": name,
		"npc": npc,
		"npc_name": npc_name,
		"completed": completed,
		"unlocked": unlocked,
	}

func _run() -> void:
	print("trial picker")
	var NPC = load("res://scripts/npc.gd")

	var wall := quest(1, "The Wall at the Sixteen Colors", "Ridit", "Ridit")
	var stake := quest(2, "Claim Your Stake", "Ridit", "Ridit")
	var mabel := quest(3, "A Music player for the saloon", "Mabel", "Mabel")

	# The authored Trial wins while it is still open.
	var picked: Dictionary = NPC.pick_trial_for([wall, stake, mabel], wall.name, "Ridit", false)
	check(picked.get("name") == wall.name, "open authored Trial is offered first")

	# Once it's completed, the next active Trial for the same giver follows.
	wall["completed"] = true
	picked = NPC.pick_trial_for([wall, stake, mabel], wall.name, "Ridit", false)
	check(picked.get("name") == stake.name, "completed authored Trial falls through to the follow-up")

	# If every follow-up is done too, keep the authored Trial so its completion
	# line still shows instead of falling back to flavor text.
	stake["completed"] = true
	picked = NPC.pick_trial_for([wall, stake, mabel], wall.name, "Ridit", false)
	check(picked.get("name") == wall.name, "all Trials done returns the authored Trial")

	# A stale/missing authored link still recovers via the Trial's own npc field.
	stake["completed"] = false
	picked = NPC.pick_trial_for([stake, mabel], "A Trial that no longer exists", "Ridit", false)
	check(picked.get("name") == stake.name, "missing authored Trial recovers via the giver name")

	# A linked giver row pointing at another NPC must not hide the Trial's
	# authored giver either.
	var repointed := quest(4, "A Follow-up", "Ridit", "Somebody Else")
	picked = NPC.pick_trial_for([wall, repointed], wall.name, "Ridit", false)
	check(picked.get("name") == repointed.name, "Trial npc field still matches its real giver")

	# Check-in copies never hop to a follow-up; they represent one specific Trial.
	picked = NPC.pick_trial_for([wall, stake], wall.name, "Ridit", true)
	check(picked.get("name") == wall.name, "check-in copy stays on its authored Trial")

	# Other givers' Trials are never offered.
	picked = NPC.pick_trial_for([wall, mabel], wall.name, "Ridit", false)
	check(picked.get("name") == wall.name, "another giver's Trial is never picked")

	# Nothing matches at all: the caller falls back to flavor text.
	picked = NPC.pick_trial_for([mabel], "A Trial that no longer exists", "Ridit", false)
	check(picked.is_empty(), "no authored or follow-up Trial returns empty")

	if _fail == 0:
		print("all trial picker checks passed")
	else:
		printerr("%d check(s) failed" % _fail)
	quit(1 if _fail > 0 else 0)
