---
title: Roblox guide
group: Guides
description: Trials like Tim's coin collecting game show up because Roblox is genuinely a solid platform to ship on, you get a huge built in audience and you don't need to worry about hosting o
---

# Roblox guide

Trials like Tim's coin collecting game show up because Roblox is genuinely a solid platform to ship on, you get a huge built in audience and you don't need to worry about hosting or app store approval.

## Getting set up

Download Roblox Studio from create.roblox.com, it's free. Once it's installed, open it and start from the Baseplate template, that gives you an empty flat world to build in instead of starting from nothing.

## The basics of how a Roblox game is put together

Everything lives in the Explorer panel on the right. A few things worth knowing right away:

- Workspace holds everything physically in the game world, parts, models, terrain
- Lighting controls how the game looks, time of day, brightness, that kind of thing
- ServerScriptService is where scripts run that only the server should handle, things like giving out coins
- StarterGui is where you put UI that gets copied to every player when they join

## Scripting basics

Roblox uses Lua, specifically a version called Luau. A simple script that gives a player a coin when they touch a part looks something like:

```lua
local part = script.Parent

part.Touched:Connect(function(hit)
  local player = game.Players:GetPlayerFromCharacter(hit.Parent)
  if player then
    print(player.Name .. " touched the coin")
    part:Destroy()
  end
end)
```

Put that inside a Script that's a child of the coin part, and touching the coin makes it disappear and prints a message. From there you'd build out an actual currency system, probably using leaderstats to show a score on the player list.

## Leaderstats, the standard way to track score

```lua
game.Players.PlayerAdded:Connect(function(player)
  local stats = Instance.new("Folder")
  stats.Name = "leaderstats"
  stats.Parent = player

  local coins = Instance.new("IntValue")
  coins.Name = "Coins"
  coins.Value = 0
  coins.Parent = stats
end)
```

This is the standard pattern almost every Roblox game with a score or currency uses, it automatically shows up in the player list in game.

## Publishing your game

Once it's working, go to File, then Publish to Roblox. Give it a name, description, and a thumbnail if you've got one, then it's live and playable by anyone with the link, including Tim and his friends.

Before you publish, set the game's age rating to 16+ in its settings. Roblox charges a fee to launch a game rated under 16, so leaving it on the default rating can cost you money, setting it to 16+ keeps publishing free.

## Keeping it a real trial

Don't just publish the default Baseplate with one script dropped in. Add a few coins spread around a real map, a win condition, maybe a simple shop, something that shows actual game design thinking, not just a single working mechanic.
