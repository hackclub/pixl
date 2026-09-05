---
title: Roblox guide
group: Guides
description: Build and publish 3D multiplayer experiences with Roblox Studio and Luau.
---

# Roblox guide

^ Roblox is a powerful platform for game developers: it handles multiplayer networking, server hosting, and cross-platform clients out of the box.

## Getting started

Download **Roblox Studio** from [create.roblox.com](https://create.roblox.com). Launch Studio and create a new project using the standard **Baseplate** template.

## Understanding the workspace

- **Workspace:** Contains all 3D geometry, models, lights, and physics parts.
- **ServerScriptService:** Runs secure backend scripts that handle game logic, leaderboards, and currencies.
- **StarterGui:** Holds 2D interface elements (HUDs, buttons, inventory screens) copied to players upon spawning.

## Scripting gameplay with Luau

Create a coin pickup mechanic by adding a `Script` inside a Part model:

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

Use this standard pattern in `ServerScriptService` to display player scores on the in-game scoreboard:

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
4. Share the playable Roblox link in your Pixl ship submission!
