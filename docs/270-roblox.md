---
title: Roblox guide
group: Guides
description: Build and publish 3D multiplayer experiences with Roblox Studio and Luau.
---

# Roblox guide

^ Roblox hands you multiplayer networking, server hosting and cross-platform clients for free, which is most of the hard part of a multiplayer game.

## Getting started

Get **Roblox Studio** from [create.roblox.com](https://create.roblox.com), open it, and start a new project from the **Baseplate** template.

## Understanding the workspace

- **Workspace:** everything in 3D. Geometry, models, lights, physics parts.
- **ServerScriptService:** server-side scripts. Game logic, leaderboards and currency go here, where players can't tamper with them.
- **StarterGui:** the 2D interface (HUDs, buttons, inventory) that gets copied to each player when they spawn.

## Scripting gameplay with Luau

A coin pickup, as a `Script` inside a Part:

```lua
local coin = script.Parent

coin.Touched:Connect(function(hit)
  local character = hit.Parent
  local player = game.Players:GetPlayerFromCharacter(character)
  
  if player and player:FindFirstChild("leaderstats") then
    local coins = player.leaderstats:FindFirstChild("Coins")
    if coins then
      coins.Value = coins.Value + 1
      coin:Destroy()
    end
  end
end)
```

## Creating player leaderstats

This is the standard way to get a score onto the in-game scoreboard. It goes in `ServerScriptService`:

```lua
game.Players.PlayerAdded:Connect(function(player)
  local leaderstats = Instance.new("Folder")
  leaderstats.Name = "leaderstats"
  leaderstats.Parent = player

  local coins = Instance.new("IntValue")
  coins.Name = "Coins"
  coins.Value = 0
  coins.Parent = leaderstats
end)
```

## Publishing your game

1. Go to **File → Publish to Roblox**.
2. Set a title, description, and thumbnail.
3. In Game Settings, set the **Age Recommendation to 16+** (publishing games under 16+ may incur Roblox platform review fees, while 16+ is free).
4. Put the playable Roblox link in your Pixl submission.
