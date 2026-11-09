# Turret Reach Indicator

A small client-side Mindustry mod that draws your team's turret ranges on the minimap,
so you can see your base's defensive coverage and spot the gaps an enemy could slip through.

## Features

- Compact **Turret reach** panel in the top-right corner of the fullscreen map (`M` key): eye button toggles the overlay.
- Coverage is drawn as one merged outline: overlapping ranges show only their outer edge, with no lines inside.
  Holes and gaps in your defense are easy to spot.
- Gear button opens the options:
  - **All turrets**: every turret's range
  - **Ground-targeting**: only turrets that can hit ground units
  - **Air-targeting**: only turrets that can hit air units
  - **Fire extinguishing**: liquid turrets that can put out fires (Wave, Tsunami, ...)
  - **Individual circles**: draw every turret's circle instead of the merged outline
- Shows on the fullscreen map and on the corner minimap.
- Ranges include ammo range bonuses and update live as you build or lose turrets.
- Settings are remembered between games.
- Client-side only (`hidden: true`): works on servers that don't have the mod, and other players don't need it.

## Installation

Requires Mindustry v8 (build 147 or newer).

**Option A: import as zip**

1. Zip the *contents* of the `turret-reach-indicator` folder so `mod.hjson` sits at the zip root:
   ```sh
   cd turret-reach-indicator && zip -r ../turret-reach-indicator.zip mod.hjson scripts
   ```
2. In game: **Mods → Import Mod → Import File** and choose the zip.
3. Restart the game.

**Option B: copy the folder**

Copy the `turret-reach-indicator` folder into your Mindustry mods directory and restart:

| OS      | Mods directory                                     |
|---------|----------------------------------------------------|
| Windows | `%AppData%\Mindustry\mods\`                        |
| Linux   | `~/.local/share/Mindustry/mods/`                   |
| macOS   | `~/Library/Application Support/Mindustry/mods/`    |
| Steam   | `<Steam>/steamapps/common/Mindustry/saves/mods/`   |

## Usage

1. Start or join a game and press `M` to open the map.
2. Click the eye button next to **Turret reach** (top-right) to turn the overlay on or off.
3. Click the gear next to it to pick which turrets to show.

## Files

```
turret-reach-indicator/
├── mod.hjson         # mod metadata
└── scripts/main.js   # all the logic
```

## How it works

The mod adds an invisible map marker that the game's own minimap renderer draws each frame,
so circles land in the right place at any zoom level without patching the game.
The marker is never added to the saved marker list, so it never ends up in save or map files.
Turret positions and ranges are refreshed twice per second.

## Limitations

- Shows only your own team's turrets.

## License

MIT
