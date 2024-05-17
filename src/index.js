const { LRUCache } = require('lru-cache');
const https = require("https");
import Bottleneck from "bottleneck";

const GUILD_IDS = [
    "669128285527080961",   // Default
    "961967923319169034",   // French
    "1007663744500891720",  // RU & EU
    "1077592694492233781",  // Czech
    "1081202781920165968",  // Polish
    "1081233602613878836",  // German
    "1093160288729169993",  // Ukrainian
    "1171464808080609301",  // LATAM
    "1171473905052033075",  // Brazilian
];
const USERNAME_PATTERN = /([a-zA-Z0-9_]+) \[(EU|NA|ASIA)\]$/;
const EXTENSION_MAP = {
    "EU": "eu",
    "NA": "com",
    "ASIA": "asia",
};
const COLORS = {
    hidden: "#7D7D7D",
    bottom: "#FE0E00",
    bars: {
        0.47: "#FE7903",
        0.49: "#FFC71F",
        0.52: "#44B300",
        0.54: "#318000",
        0.56: "#02C9B3",
        0.60: "#D042F3",
        0.65: "#A00DC5",
    },
};
const LABELS = {
    bottom: "Plain Bad",
    bars: {
        0.46: "Casual",
        0.49: "Regular",
        0.53: "Enthusiast",
        0.56: "Hardcore",
        0.60: "SuperTester",
    }
}
const DEFAULTS = {
    DISPLAY: "WINRATE",
    LIMITER_OPTIONS: {
        reservoir: 15,
        reservoirRefreshAmount: 15,
        reservoirRefreshInterval: 1000,
       
        maxConcurrent: 10,
        minTime: 25,
    },
    CACHE_OPTIONS: {
        max: 500,
        ttl: 3 * 1000 * 60 * 60 * 24,  // 3 days
        noUpdateTTL: true,  // ensures statistics don't get stale
    }
}

var limiter;

function getColor(winrate) {
    let color = COLORS["bottom"];
    for (const bar in COLORS["bars"]) {
        if (winrate < bar) {
            break;
        }
        color = COLORS["bars"][bar];
    }
    return color;
}
function getLabel(winrate) {
    let label = LABELS["bottom"];
    for (const bar in LABELS["bars"]) {
        if (winrate < bar) {
            break;
        }
        label = LABELS["bars"][bar];
    }
    return label;
}

async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                for (const num of chunk) {
                    data += String.fromCharCode(num);
                }
            });
            res.on("end", () => {
                resolve(JSON.parse(data));
            });
        });
    });
}

export default class WoWSCommunityMonitor {
    constructor(meta) {
        this.settings = Object.assign({}, DEFAULTS, BdApi.Data.load("WoWSCommunityMonitor", "settings"));

        let cache_options = Object.assign({}, this.settings.CACHE_OPTIONS);
        cache_options.fetchMethod = this.fetchUser;
        this.cache = new LRUCache(cache_options);

        limiter = new Bottleneck(this.settings.LIMITER_OPTIONS);
        BdApi.Data.save("WoWSCommunityMonitor", "settings", this.settings);
    }

    async fetchUser(nickname, stale, { signal, options, context }) {
        // console.log(`Requested ${nickname}`)
        let user = {
            spa_id: null,
            hidden: null,
            winrate: null,
        }

        let match = nickname.match(USERNAME_PATTERN);
        if (match == null || match.length == 1) return user;

        let username = match[1];
        let extension = EXTENSION_MAP[match[2]];
        let account = await limiter.schedule(() => fetchJSON(
            `https://vortex.worldofwarships.${extension}/api/accounts/search/autocomplete/${username}/?limit=1`
        ));
        if (account.status !== "ok" || !account.data.length) return user;
        user.spa_id = account.data[0].spa_id, user.hidden = account.data[0].hidden;
        if (user.hidden) return user;

        let info = await limiter.schedule(() => fetchJSON(
            `https://vortex.worldofwarships.${extension}/api/accounts/${user.spa_id}/`
        ));
        if (info["status"] !== "ok" || !Object.keys(info).length) return user;
        let player = info.data[user.spa_id];
        if (!player || player.statistics.pvp == null) return user;
        user.winrate = player.statistics.pvp.wins / player.statistics.pvp.battles_count;

        return user;
    }

    start() {
        const MessageAuthors = BdApi.Webpack.getByStrings(
            "message", "author", "roleStyle", { defaultExport: false }
        );
        
        BdApi.Patcher.after(
            "WoWSCommunityMonitor", MessageAuthors, "default", (context, args, returned) => {
                if (!GUILD_IDS.includes(args[0].channel.guild_id)) return;

                let user = this.cache.get(args[0].author.nick);

                if (user == undefined) {
                    this.cache.fetch(args[0].author.nick);
                    return;
                }

                let color, text;
                if (user.hidden) {
                    color = COLORS.hidden;
                    text = " [Hidden] ";
                }
                else if (user.spa_id == null || user.winrate == null) {
                    color = COLORS.hidden;
                    text = " [Unknown] ";
                }
                else {
                    color = getColor(user.winrate);
                    if (this.settings.DISPLAY == "LABEL") {
                        text = ` [${getLabel(user.winrate)}] `;
                    }
                    else {
                        text = ` [${(user.winrate * 100).toFixed(2)}%] `;
                    }
                }

                returned.props.children.push(BdApi.React.createElement(
                    "span", { "style": { "color": color } }, text
                ));
            }
        );
    }

    stop() {
        BdApi.Patcher.unpatchAll("WoWSCommunityMonitor");
    }
};