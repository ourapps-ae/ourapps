// The OurPoker recipe and the catalogue entries of its 39 components, as https://ourapps.app served them on 2026-11-10.
// Trimmed to the fields the diagrams read. Test data only.
import type { Condition, Port, Targets } from "../catalogue.js";

export interface FixtureComponent { name: string; version: string; category: string | null; targets: Targets; provides: Port[]; requires: Port[]; profiles: { id: string; settings: Record<string, string | number | boolean> }[] }

export const OURPOKER_RECIPE: { name: string; version: string; title: string; components: { id: string; name: string; version: string; includedWhen: Condition | null }[]; connections: { source: { instance: string; port: string }; target: { instance: string; port: string } }[] } = {
 "name": "ourapps-ae/ourpoker",
 "version": "0.3.3",
 "title": "OurPoker",
 "components": [
  {
   "id": "web-host",
   "name": "ourapps-ae/web-host",
   "version": "0.3.0",
   "includedWhen": {
    "question": "targets",
    "contains": "web"
   }
  },
  {
   "id": "apple-host",
   "name": "ourapps-ae/apple-host",
   "version": "0.4.0",
   "includedWhen": {
    "any": [
     {
      "question": "targets",
      "contains": "ios"
     },
     {
      "question": "targets",
      "contains": "macos"
     },
     {
      "question": "targets",
      "contains": "tvos"
     }
    ]
   }
  },
  {
   "id": "android-host",
   "name": "ourapps-ae/android-host",
   "version": "0.3.0",
   "includedWhen": {
    "question": "targets",
    "contains": "android"
   }
  },
  {
   "id": "windows-desktop",
   "name": "ourapps-ae/windows-desktop",
   "version": "0.4.0",
   "includedWhen": {
    "question": "targets",
    "contains": "windows"
   }
  },
  {
   "id": "server-host",
   "name": "ourapps-ae/server-host",
   "version": "0.4.0",
   "includedWhen": null
  },
  {
   "id": "ourapps-release",
   "name": "ourapps-ae/ourapps-release",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "store-update",
   "name": "ourapps-ae/store-update",
   "version": "0.4.0",
   "includedWhen": {
    "question": "updates",
    "equals": true
   }
  },
  {
   "id": "realtime-rooms",
   "name": "ourapps-ae/realtime-rooms",
   "version": "0.5.0",
   "includedWhen": null
  },
  {
   "id": "room-directory",
   "name": "ourapps-ae/room-directory",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "guest-identity",
   "name": "ourapps-ae/guest-identity",
   "version": "0.4.0",
   "includedWhen": null
  },
  {
   "id": "presence",
   "name": "ourapps-ae/presence",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "invitations",
   "name": "ourapps-ae/invitations",
   "version": "0.1.1",
   "includedWhen": null
  },
  {
   "id": "private-views",
   "name": "ourapps-ae/private-views",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "display-mode",
   "name": "ourapps-ae/display-mode",
   "version": "0.4.0",
   "includedWhen": null
  },
  {
   "id": "video-calls",
   "name": "ourapps-ae/video-calls",
   "version": "0.4.0",
   "includedWhen": {
    "question": "video",
    "equals": true
   }
  },
  {
   "id": "preferences",
   "name": "ourapps-ae/preferences",
   "version": "0.1.1",
   "includedWhen": null
  },
  {
   "id": "turn-engine",
   "name": "ourapps-ae/turn-engine",
   "version": "0.4.0",
   "includedWhen": null
  },
  {
   "id": "game-clock",
   "name": "ourapps-ae/game-clock",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "seating",
   "name": "ourapps-ae/seating",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "fair-shuffle",
   "name": "ourapps-ae/fair-shuffle",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "card-deck",
   "name": "ourapps-ae/card-deck",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "computer-players",
   "name": "ourapps-ae/computer-players",
   "version": "0.4.0",
   "includedWhen": {
    "not": {
     "question": "computerPlayers",
     "equals": "none"
    }
   }
  },
  {
   "id": "chip-ledger",
   "name": "ourapps-ae/chip-ledger",
   "version": "0.4.0",
   "includedWhen": null
  },
  {
   "id": "level-schedule",
   "name": "ourapps-ae/level-schedule",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "tournament",
   "name": "ourapps-ae/tournament",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "round-history",
   "name": "ourapps-ae/round-history",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "rules-settings",
   "name": "ourapps-ae/rules-settings",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "poker-hand-ranking",
   "name": "ourapps-ae/poker-hand-ranking",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "poker-odds",
   "name": "ourapps-ae/poker-odds",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "holdem-rules",
   "name": "ourapps-ae/holdem-rules",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "poker-strategy",
   "name": "ourapps-ae/poker-strategy",
   "version": "0.3.0",
   "includedWhen": {
    "not": {
     "question": "computerPlayers",
     "equals": "none"
    }
   }
  },
  {
   "id": "theme",
   "name": "ourapps-ae/theme",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "controls",
   "name": "ourapps-ae/controls",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "table-layout",
   "name": "ourapps-ae/table-layout",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "card-graphics",
   "name": "ourapps-ae/card-graphics",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "chip-graphics",
   "name": "ourapps-ae/chip-graphics",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "sound-cues",
   "name": "ourapps-ae/sound-cues",
   "version": "0.3.0",
   "includedWhen": null
  },
  {
   "id": "guided-tour",
   "name": "ourapps-ae/guided-tour",
   "version": "0.3.0",
   "includedWhen": {
    "question": "lessons",
    "equals": true
   }
  },
  {
   "id": "translations",
   "name": "ourapps-ae/translations",
   "version": "0.4.0",
   "includedWhen": null
  }
 ],
 "connections": [
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "web-host",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "apple-host",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "android-host",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "realtime-rooms",
    "port": "session"
   },
   "target": {
    "instance": "server-host",
    "port": "room-session"
   }
  },
  {
   "source": {
    "instance": "room-directory",
    "port": "room-directory"
   },
   "target": {
    "instance": "server-host",
    "port": "room-directory"
   }
  },
  {
   "source": {
    "instance": "application",
    "port": "poker-game-adapter"
   },
   "target": {
    "instance": "realtime-rooms",
    "port": "game"
   }
  },
  {
   "source": {
    "instance": "guest-identity",
    "port": "guest-identity"
   },
   "target": {
    "instance": "realtime-rooms",
    "port": "guest-identity"
   }
  },
  {
   "source": {
    "instance": "realtime-rooms",
    "port": "session"
   },
   "target": {
    "instance": "room-directory",
    "port": "room-session"
   }
  },
  {
   "source": {
    "instance": "guest-identity",
    "port": "guest-identity"
   },
   "target": {
    "instance": "presence",
    "port": "guest-identity"
   }
  },
  {
   "source": {
    "instance": "holdem-rules",
    "port": "game-rules"
   },
   "target": {
    "instance": "turn-engine",
    "port": "game-rules"
   }
  },
  {
   "source": {
    "instance": "seating",
    "port": "seating"
   },
   "target": {
    "instance": "turn-engine",
    "port": "seating"
   }
  },
  {
   "source": {
    "instance": "game-clock",
    "port": "game-clock"
   },
   "target": {
    "instance": "turn-engine",
    "port": "game-clock"
   }
  },
  {
   "source": {
    "instance": "private-views",
    "port": "private-views"
   },
   "target": {
    "instance": "turn-engine",
    "port": "private-views"
   }
  },
  {
   "source": {
    "instance": "presence",
    "port": "presence"
   },
   "target": {
    "instance": "turn-engine",
    "port": "presence"
   }
  },
  {
   "source": {
    "instance": "tournament",
    "port": "tournament"
   },
   "target": {
    "instance": "turn-engine",
    "port": "tournament"
   }
  },
  {
   "source": {
    "instance": "computer-players",
    "port": "computer-players"
   },
   "target": {
    "instance": "turn-engine",
    "port": "computer-players"
   }
  },
  {
   "source": {
    "instance": "round-history",
    "port": "round-history"
   },
   "target": {
    "instance": "turn-engine",
    "port": "round-history"
   }
  },
  {
   "source": {
    "instance": "rules-settings",
    "port": "rules-settings"
   },
   "target": {
    "instance": "turn-engine",
    "port": "rules-settings"
   }
  },
  {
   "source": {
    "instance": "guest-identity",
    "port": "guest-identity"
   },
   "target": {
    "instance": "seating",
    "port": "guest-identity"
   }
  },
  {
   "source": {
    "instance": "fair-shuffle",
    "port": "random-source"
   },
   "target": {
    "instance": "card-deck",
    "port": "random-source"
   }
  },
  {
   "source": {
    "instance": "poker-strategy",
    "port": "player-strategy"
   },
   "target": {
    "instance": "computer-players",
    "port": "player-strategy"
   }
  },
  {
   "source": {
    "instance": "game-clock",
    "port": "game-clock"
   },
   "target": {
    "instance": "computer-players",
    "port": "game-clock"
   }
  },
  {
   "source": {
    "instance": "seating",
    "port": "seating"
   },
   "target": {
    "instance": "computer-players",
    "port": "seating"
   }
  },
  {
   "source": {
    "instance": "chip-ledger",
    "port": "chip-ledger"
   },
   "target": {
    "instance": "tournament",
    "port": "chip-ledger"
   }
  },
  {
   "source": {
    "instance": "level-schedule",
    "port": "level-schedule"
   },
   "target": {
    "instance": "tournament",
    "port": "level-schedule"
   }
  },
  {
   "source": {
    "instance": "seating",
    "port": "seating"
   },
   "target": {
    "instance": "tournament",
    "port": "seating"
   }
  },
  {
   "source": {
    "instance": "card-deck",
    "port": "card-deck"
   },
   "target": {
    "instance": "poker-hand-ranking",
    "port": "card-deck"
   }
  },
  {
   "source": {
    "instance": "poker-hand-ranking",
    "port": "hand-ranking"
   },
   "target": {
    "instance": "poker-odds",
    "port": "hand-ranking"
   }
  },
  {
   "source": {
    "instance": "card-deck",
    "port": "card-deck"
   },
   "target": {
    "instance": "poker-odds",
    "port": "card-deck"
   }
  },
  {
   "source": {
    "instance": "card-deck",
    "port": "card-deck"
   },
   "target": {
    "instance": "holdem-rules",
    "port": "card-deck"
   }
  },
  {
   "source": {
    "instance": "chip-ledger",
    "port": "chip-ledger"
   },
   "target": {
    "instance": "holdem-rules",
    "port": "chip-ledger"
   }
  },
  {
   "source": {
    "instance": "level-schedule",
    "port": "level-schedule"
   },
   "target": {
    "instance": "holdem-rules",
    "port": "level-schedule"
   }
  },
  {
   "source": {
    "instance": "poker-hand-ranking",
    "port": "hand-ranking"
   },
   "target": {
    "instance": "holdem-rules",
    "port": "hand-ranking"
   }
  },
  {
   "source": {
    "instance": "rules-settings",
    "port": "rules-settings"
   },
   "target": {
    "instance": "holdem-rules",
    "port": "rules-settings"
   }
  },
  {
   "source": {
    "instance": "poker-hand-ranking",
    "port": "hand-ranking"
   },
   "target": {
    "instance": "poker-strategy",
    "port": "hand-ranking"
   }
  },
  {
   "source": {
    "instance": "poker-odds",
    "port": "poker-odds"
   },
   "target": {
    "instance": "poker-strategy",
    "port": "poker-odds"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "controls",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "table-layout",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "controls",
    "port": "controls"
   },
   "target": {
    "instance": "table-layout",
    "port": "controls"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "card-graphics",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "chip-graphics",
    "port": "theme"
   }
  },
  {
   "source": {
    "instance": "preferences",
    "port": "preferences"
   },
   "target": {
    "instance": "sound-cues",
    "port": "preferences"
   }
  },
  {
   "source": {
    "instance": "controls",
    "port": "controls"
   },
   "target": {
    "instance": "guided-tour",
    "port": "controls"
   }
  },
  {
   "source": {
    "instance": "preferences",
    "port": "preferences"
   },
   "target": {
    "instance": "guided-tour",
    "port": "preferences"
   }
  },
  {
   "source": {
    "instance": "translations",
    "port": "language"
   },
   "target": {
    "instance": "guided-tour",
    "port": "language"
   }
  },
  {
   "source": {
    "instance": "turn-engine",
    "port": "game-adapter"
   },
   "target": {
    "instance": "application",
    "port": "game-adapter"
   }
  },
  {
   "source": {
    "instance": "web-host",
    "port": "web-shell"
   },
   "target": {
    "instance": "application",
    "port": "web-shell"
   }
  },
  {
   "source": {
    "instance": "apple-host",
    "port": "apple-shell"
   },
   "target": {
    "instance": "application",
    "port": "apple-shell"
   }
  },
  {
   "source": {
    "instance": "android-host",
    "port": "android-shell"
   },
   "target": {
    "instance": "application",
    "port": "android-shell"
   }
  },
  {
   "source": {
    "instance": "windows-desktop",
    "port": "facility"
   },
   "target": {
    "instance": "application",
    "port": "desktop-host"
   }
  },
  {
   "source": {
    "instance": "server-host",
    "port": "server-host"
   },
   "target": {
    "instance": "application",
    "port": "server-host"
   }
  },
  {
   "source": {
    "instance": "ourapps-release",
    "port": "release-pipeline"
   },
   "target": {
    "instance": "application",
    "port": "release-pipeline"
   }
  },
  {
   "source": {
    "instance": "invitations",
    "port": "invitations"
   },
   "target": {
    "instance": "application",
    "port": "invitations"
   }
  },
  {
   "source": {
    "instance": "display-mode",
    "port": "facility"
   },
   "target": {
    "instance": "application",
    "port": "display-policy"
   }
  },
  {
   "source": {
    "instance": "video-calls",
    "port": "facility"
   },
   "target": {
    "instance": "application",
    "port": "media-session"
   }
  },
  {
   "source": {
    "instance": "table-layout",
    "port": "table-layout"
   },
   "target": {
    "instance": "application",
    "port": "table-layout"
   }
  },
  {
   "source": {
    "instance": "card-graphics",
    "port": "card-graphics"
   },
   "target": {
    "instance": "application",
    "port": "card-graphics"
   }
  },
  {
   "source": {
    "instance": "chip-graphics",
    "port": "chip-graphics"
   },
   "target": {
    "instance": "application",
    "port": "chip-graphics"
   }
  },
  {
   "source": {
    "instance": "sound-cues",
    "port": "sound-cues"
   },
   "target": {
    "instance": "application",
    "port": "sound-cues"
   }
  },
  {
   "source": {
    "instance": "guided-tour",
    "port": "guided-tour"
   },
   "target": {
    "instance": "application",
    "port": "guided-tour"
   }
  },
  {
   "source": {
    "instance": "store-update",
    "port": "updates"
   },
   "target": {
    "instance": "application",
    "port": "updates"
   }
  },
  {
   "source": {
    "instance": "controls",
    "port": "controls"
   },
   "target": {
    "instance": "application",
    "port": "controls"
   }
  },
  {
   "source": {
    "instance": "preferences",
    "port": "preferences"
   },
   "target": {
    "instance": "application",
    "port": "preferences"
   }
  },
  {
   "source": {
    "instance": "translations",
    "port": "language"
   },
   "target": {
    "instance": "application",
    "port": "language"
   }
  },
  {
   "source": {
    "instance": "theme",
    "port": "theme"
   },
   "target": {
    "instance": "application",
    "port": "theme"
   }
  }
 ]
};

export const OURPOKER_CATALOGUE: FixtureComponent[] = [
 {
  "name": "ourapps-ae/android-host",
  "version": "0.3.0",
  "category": "delivery",
  "targets": {
   "client": [
    "android"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "android-shell",
    "type": "ae/android-shell",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/apple-host",
  "version": "0.4.0",
  "category": "delivery",
  "targets": {
   "client": [
    "ios",
    "macos",
    "tvos"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "apple-shell",
    "type": "ae/apple-shell",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/card-deck",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "card-deck",
    "type": "ae/card-deck",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "random-source",
    "type": "ae/random-source",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/card-graphics",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "card-graphics",
    "type": "ae/card-graphics",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/chip-graphics",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "chip-graphics",
    "type": "ae/chip-graphics",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/chip-ledger",
  "version": "0.4.0",
  "category": "game-framework",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "chip-ledger",
    "type": "ae/chip-ledger",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/computer-players",
  "version": "0.4.0",
  "category": "game-framework",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "computer-players",
    "type": "ae/computer-players",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "player-strategy",
    "type": "ae/player-strategy",
    "version": "1.0.0"
   },
   {
    "id": "game-clock",
    "type": "ae/game-clock",
    "version": "1.0.0"
   },
   {
    "id": "seating",
    "type": "ae/seating",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/controls",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "controls",
    "type": "ae/controls",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/display-mode",
  "version": "0.4.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "facility",
    "type": "ae/display-policy",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "configuration",
    "type": "ae/display-mode-configuration",
    "version": "1.0.0",
    "optional": true
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/fair-shuffle",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "random-source",
    "type": "ae/random-source",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/game-clock",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "game-clock",
    "type": "ae/game-clock",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/guest-identity",
  "version": "0.4.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "guest-identity",
    "type": "ae/guest-identity",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/guided-tour",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "guided-tour",
    "type": "ae/guided-tour",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "controls",
    "type": "ae/controls",
    "version": "1.0.0"
   },
   {
    "id": "preferences",
    "type": "ae/preferences",
    "version": "1.0.0"
   },
   {
    "id": "language",
    "type": "ae/language",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/holdem-rules",
  "version": "0.3.0",
  "category": "poker",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "game-rules",
    "type": "ae/game-rules",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "card-deck",
    "type": "ae/card-deck",
    "version": "1.0.0"
   },
   {
    "id": "chip-ledger",
    "type": "ae/chip-ledger",
    "version": "1.0.0"
   },
   {
    "id": "level-schedule",
    "type": "ae/level-schedule",
    "version": "1.0.0"
   },
   {
    "id": "hand-ranking",
    "type": "ae/hand-ranking",
    "version": "1.0.0"
   },
   {
    "id": "rules-settings",
    "type": "ae/rules-settings",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/invitations",
  "version": "0.1.1",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "invitations",
    "type": "ae/invitations",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/level-schedule",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "level-schedule",
    "type": "ae/level-schedule",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/ourapps-release",
  "version": "0.3.0",
  "category": "delivery",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "release-pipeline",
    "type": "ae/release-pipeline",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/poker-hand-ranking",
  "version": "0.3.0",
  "category": "poker",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "hand-ranking",
    "type": "ae/hand-ranking",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "card-deck",
    "type": "ae/card-deck",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/poker-odds",
  "version": "0.3.0",
  "category": "poker",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "poker-odds",
    "type": "ae/poker-odds",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "hand-ranking",
    "type": "ae/hand-ranking",
    "version": "1.0.0"
   },
   {
    "id": "card-deck",
    "type": "ae/card-deck",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/poker-strategy",
  "version": "0.3.0",
  "category": "poker",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "player-strategy",
    "type": "ae/player-strategy",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "hand-ranking",
    "type": "ae/hand-ranking",
    "version": "1.0.0"
   },
   {
    "id": "poker-odds",
    "type": "ae/poker-odds",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/preferences",
  "version": "0.1.1",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "preferences",
    "type": "ae/preferences",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/presence",
  "version": "0.3.0",
  "category": "rooms",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "presence",
    "type": "ae/presence",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "guest-identity",
    "type": "ae/guest-identity",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/private-views",
  "version": "0.3.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "private-views",
    "type": "ae/private-views",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/realtime-rooms",
  "version": "0.5.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": [
    "hosting-provider",
    "own-hardware"
   ]
  },
  "provides": [
   {
    "id": "session",
    "type": "ae/room-session",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "game",
    "type": "ae/game-adapter",
    "version": "1.0.0"
   },
   {
    "id": "guest-identity",
    "type": "ae/guest-identity",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "free",
    "settings": {}
   },
   {
    "id": "paid",
    "settings": {}
   },
   {
    "id": "own-hardware",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/room-directory",
  "version": "0.3.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": [
    "hosting-provider",
    "own-hardware"
   ]
  },
  "provides": [
   {
    "id": "room-directory",
    "type": "ae/room-directory",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "room-session",
    "type": "ae/room-session",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/round-history",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "round-history",
    "type": "ae/round-history",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/rules-settings",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "rules-settings",
    "type": "ae/rules-settings",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/seating",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "seating",
    "type": "ae/seating",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "guest-identity",
    "type": "ae/guest-identity",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/server-host",
  "version": "0.4.0",
  "category": "delivery",
  "targets": {
   "client": [],
   "server": [
    "hosting-provider",
    "own-hardware"
   ]
  },
  "provides": [
   {
    "id": "server-host",
    "type": "ae/server-host",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "room-session",
    "type": "ae/room-session",
    "version": "1.0.0"
   },
   {
    "id": "room-directory",
    "type": "ae/room-directory",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "cloudflare-free",
    "settings": {}
   },
   {
    "id": "cloudflare-paid",
    "settings": {}
   },
   {
    "id": "own-hardware",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/sound-cues",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "sound-cues",
    "type": "ae/sound-cues",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "preferences",
    "type": "ae/preferences",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/store-update",
  "version": "0.4.0",
  "category": "delivery",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "updates",
    "type": "ae/updates",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/table-layout",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "table-layout",
    "type": "ae/table-layout",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   },
   {
    "id": "controls",
    "type": "ae/controls",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/theme",
  "version": "0.3.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/tournament",
  "version": "0.3.0",
  "category": "game-framework",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "tournament",
    "type": "ae/tournament",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "chip-ledger",
    "type": "ae/chip-ledger",
    "version": "1.0.0"
   },
   {
    "id": "level-schedule",
    "type": "ae/level-schedule",
    "version": "1.0.0"
   },
   {
    "id": "seating",
    "type": "ae/seating",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/translations",
  "version": "0.4.0",
  "category": "presentation",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "language",
    "type": "ae/language",
    "version": "1.0.0"
   }
  ],
  "requires": [],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/turn-engine",
  "version": "0.4.0",
  "category": "game-framework",
  "targets": {
   "client": [],
   "server": []
  },
  "provides": [
   {
    "id": "game-adapter",
    "type": "ae/game-adapter",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "game-rules",
    "type": "ae/game-rules",
    "version": "1.0.0"
   },
   {
    "id": "seating",
    "type": "ae/seating",
    "version": "1.0.0"
   },
   {
    "id": "game-clock",
    "type": "ae/game-clock",
    "version": "1.0.0"
   },
   {
    "id": "private-views",
    "type": "ae/private-views",
    "version": "1.0.0"
   },
   {
    "id": "presence",
    "type": "ae/presence",
    "version": "1.0.0"
   },
   {
    "id": "tournament",
    "type": "ae/tournament",
    "version": "1.0.0"
   },
   {
    "id": "computer-players",
    "type": "ae/computer-players",
    "version": "1.0.0",
    "optional": true
   },
   {
    "id": "round-history",
    "type": "ae/round-history",
    "version": "1.0.0"
   },
   {
    "id": "rules-settings",
    "type": "ae/rules-settings",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/video-calls",
  "version": "0.4.0",
  "category": "rooms",
  "targets": {
   "client": [
    "android",
    "ios",
    "macos",
    "tvos",
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "facility",
    "type": "ae/media-session",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "configuration",
    "type": "ae/video-calls-configuration",
    "version": "1.0.0",
    "optional": true
   }
  ],
  "profiles": [
   {
    "id": "free",
    "settings": {}
   },
   {
    "id": "paid",
    "settings": {}
   },
   {
    "id": "scale",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/web-host",
  "version": "0.3.0",
  "category": "delivery",
  "targets": {
   "client": [
    "web"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "web-shell",
    "type": "ae/web-shell",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "theme",
    "type": "ae/theme",
    "version": "1.0.0"
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 },
 {
  "name": "ourapps-ae/windows-desktop",
  "version": "0.4.0",
  "category": "delivery",
  "targets": {
   "client": [
    "windows"
   ],
   "server": []
  },
  "provides": [
   {
    "id": "facility",
    "type": "ae/desktop-host",
    "version": "1.0.0"
   }
  ],
  "requires": [
   {
    "id": "configuration",
    "type": "ae/windows-desktop-configuration",
    "version": "1.0.0",
    "optional": true
   }
  ],
  "profiles": [
   {
    "id": "any",
    "settings": {}
   }
  ]
 }
];
