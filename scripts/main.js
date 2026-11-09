// Turret Reach Indicator: draws turret ranges of the player's team on the minimap.

const FILTERS = [
    {id: "all", label: "All turrets", color: Pal.accent, test: b => true},
    {id: "ground", label: "Ground-targeting", color: Color.valueOf("ff8c42"), test: b => b.targetGround === true},
    {id: "air", label: "Air-targeting", color: Color.valueOf("b388ff"), test: b => b.targetAir === true},
    {id: "extinguish", label: "Fire extinguishing", color: Color.valueOf("4fc3f7"), test: b => b instanceof LiquidTurret && b.extinguish}
];

let enabled = Core.settings.getBool("tri-enabled", false);
let filterId = "" + Core.settings.getString("tri-filter", "all");
let individual = Core.settings.getBool("tri-individual", false); // false = merged outline only
let optionsOpen = false;

// cache, rebuilt every REFRESH_MS
const REFRESH_MS = 500;
let lastRefresh = 0;
let circles = []; // [x, y, r] in world units
let segments = []; // flat x1,y1,x2,y2 list of the merged outline

function filter(){
    return FILTERS.find(f => f.id == filterId) || FILTERS[0];
}

function save(key, value){
    Core.settings.put(key, value);
    lastRefresh = 0;
}

function refresh(){
    circles = [];
    segments = [];
    const f = filter();

    Vars.indexer.getFlagged(Vars.player.team(), BlockFlag.turret).each(b => {
        if(b.block instanceof BaseTurret && f.test(b.block)) circles.push([b.x, b.y, b.range()]);
    });

    if(!individual) buildOutline();
}

// plain JS Math only: from JS, Mathf.clamp(x, -1, 1) resolves to the int overload and truncates x to 0
// let, not const, inside loops: the game's Rhino keeps a const at its first-iteration value
// Outline of the union of all circles: for each circle, find the angle ranges covered by
// other circles (exact intersection angles), then draw only the uncovered arcs.
function buildOutline(){
    let TAU = Math.PI * 2;
    for(let i = 0; i < circles.length; i++){
        let c = circles[i], r = c[2];
        let covered = [];
        let hidden = false;

        for(let j = 0; j < circles.length && !hidden; j++){
            if(j == i) continue;
            let o = circles[j], R = o[2];
            let d = Math.hypot(o[0] - c[0], o[1] - c[1]);
            if(d >= r + R) continue; // apart
            // c inside o; identical circles: only the first one is drawn
            if(d + r < R || (d + r == R && (r < R || j < i))){ hidden = true; break; }
            if(d + R <= r) continue; // o sits inside c

            let phi = Math.atan2(o[1] - c[1], o[0] - c[0]);
            let alpha = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - R * R) / (2 * r * d))));
            let s = ((phi - alpha) % TAU + TAU) % TAU, e = s + alpha * 2;
            if(e > TAU){ covered.push([s, TAU], [0, e - TAU]); }else{ covered.push([s, e]); }
        }
        if(hidden) continue;

        // merge covered ranges, then walk the gaps between them
        covered.sort((a, b) => a[0] - b[0]);
        let step = TAU / Math.max(32, Math.min(180, Math.round(r / 2)));
        let at = 0;
        covered.concat([[TAU, TAU]]).forEach(iv => {
            if(iv[0] > at) arc(c, at, iv[0], step);
            at = Math.max(at, iv[1]);
        });
    }
}

function arc(c, from, to, step){
    let n = Math.max(1, Math.ceil((to - from) / step));
    let px = c[0] + Math.cos(from) * c[2], py = c[1] + Math.sin(from) * c[2];
    for(let k = 1; k <= n; k++){
        let a = from + (to - from) * k / n;
        let x = c[0] + Math.cos(a) * c[2], y = c[1] + Math.sin(a) * c[2];
        segments.push(px, py, x, y);
        px = x; py = y;
    }
}

function drawLines(){
    if(individual){
        circles.forEach(c => Lines.circle(c[0], c[1], c[2]));
    }else{
        for(let i = 0; i < segments.length; i += 4) Lines.line(segments[i], segments[i + 1], segments[i + 2], segments[i + 3]);
    }
}

// Drawn by the game's own minimap code (corner minimap and fullscreen map), already in world coordinates.
const marker = extend(MapObjectives.ObjectiveMarker, {
    draw(scaleFactor){
        if(!enabled || circles.length == 0) return;
        // world -> screen scale of the current minimap, so lines keep the same pixel width at any zoom
        const px = 1 / Draw.trans().val[0];

        // dark underlay so the line reads on any terrain
        Draw.color(Pal.darkestGray, 0.8);
        Lines.stroke(Scl.scl(4) * px);
        drawLines();

        Draw.color(filter().color);
        Lines.stroke(Scl.scl(2) * px);
        drawLines();
        Draw.reset();
    }
});
marker.world = -1;
marker.light = -1;

Events.run(Trigger.update, () => {
    if(!Vars.state.isGame()) return;

    // markers get wiped on world load / server sync, so re-attach. Not added via markers.add() so it never ends up in saves.
    const list = Vars.state.markers.mapMarkers;
    if(!list.contains(marker, true)){
        marker.minimap = list.size;
        list.add(marker);
    }

    if(enabled && Time.timeSinceMillis(lastRefresh) > REFRESH_MS){
        lastRefresh = Time.millis();
        refresh();
    }
});

// ---- UI: compact panel in the top-right of the fullscreen map (M key), styled like the game's HUD ----

// built on ClientLoadEvent: UI does not exist yet when scripts load
Events.on(ClientLoadEvent, () => {
    Vars.ui.hudGroup.fill(cons(root => {
        // not root.visible(...): in JS that name resolves to the boolean field, not the method
        root.visibility = boolp(() => Vars.ui.minimapfrag.shown());
        root.top().right().margin(8);

        root.table(cons(col => {
            // [ Turret reach  (eye)(gear) ]
            col.table(Styles.black6, cons(bar => {
                bar.margin(2);
                bar.add("Turret reach").style(Styles.outlineLabel).padLeft(8).padRight(6);
                bar.button(Icon.eyeSmall, Styles.clearNoneTogglei, () => {
                    enabled = !enabled;
                    save("tri-enabled", enabled);
                }).size(36).checked(b => enabled).tooltip("Show turret ranges");
                bar.button(Icon.settingsSmall, Styles.clearNoneTogglei, () => optionsOpen = !optionsOpen)
                    .size(36).checked(b => optionsOpen).tooltip("Options");
            })).fillX();
            col.row();

            const opts = col.table(Styles.black6, cons(o => {
                o.margin(2);
                o.defaults().height(32).growX();

                FILTERS.forEach(f => {
                    o.button("[#" + f.color + "]" + f.label, Styles.clearTogglet, () => {
                        filterId = f.id;
                        save("tri-filter", f.id);
                    }).checked(b => filterId == f.id);
                    o.row();
                });

                o.image().color(Pal.gray).height(2).pad(2);
                o.row();
                o.button("Individual circles", Styles.clearTogglet, () => {
                    individual = !individual;
                    save("tri-individual", individual);
                }).checked(b => individual);
            })).fillX().padTop(2).get();
            opts.visibility = boolp(() => optionsOpen);
        }));
    }));
});
