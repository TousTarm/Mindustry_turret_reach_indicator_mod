// Turret Reach Indicator: draws turret ranges of the player's team on the minimap.

const GROUND = Color.valueOf("ff8c42"), AIR = Color.valueOf("b388ff");
// parts: draw several filters at once, each as its own layer in its own color
const FILTERS = [
    {id: "all", label: "All turrets", color: Pal.accent, test: b => true},
    {id: "ground", label: "Ground-targeting", color: GROUND, test: b => b.targetGround === true},
    {id: "air", label: "Air-targeting", color: AIR, test: b => b.targetAir === true},
    {id: "both", label: "[#" + GROUND + "]Ground [white]+ [#" + AIR + "]air", parts: ["ground", "air"]},
    {id: "extinguish", label: "Fire extinguishing", color: Color.valueOf("4fc3f7"), test: b => b instanceof LiquidTurret && b.extinguish}
];

let enabled = Core.settings.getBool("tri-enabled", false);
let filterId = "" + Core.settings.getString("tri-filter", "all");
let individual = Core.settings.getBool("tri-individual", false); // false = merged outline only
let optionsOpen = false;

// Turret positions are checked every REFRESH_MS. When they changed, the new layers are built
// as small jobs spread over frames (at most BUDGET_NS per frame), so huge bases never freeze the game;
// the old layers stay on screen until the new ones are done.
const REFRESH_MS = 500;
const BUDGET_NS = 3000000;
let lastRefresh = 0, lastKey = "";
// one layer per drawn filter: {color, circles: [x, y, r] in world units,
// segments: flat x1,y1,x2,y2 of the merged outline, fills: flat x,y,w of FILL_ROW-high strips}
let layers = [];
let building = null, jobs = [], jobAt = 0;
const FILL_ROW = 2; // world units; the outline hides the stair-step edge
const FILL_ALPHA = 0.15;

function filter(id){
    return FILTERS.find(f => f.id == id) || FILTERS[0];
}

function reset(){
    building = null; jobs = []; jobAt = 0;
    lastKey = ""; lastRefresh = 0;
}

function save(key, value){
    Core.settings.put(key, value);
    reset();
}

function refresh(){
    const f = filter(filterId);
    const next = (f.parts || [f.id]).map(id => {
        const p = filter(id);
        const L = {color: p.color, circles: [], segments: [], fills: [], rows: {}};
        Vars.indexer.getFlagged(Vars.player.team(), BlockFlag.turret).each(b => {
            if(b.block instanceof BaseTurret && p.test(b.block)) L.circles.push([b.x, b.y, b.range()]);
        });
        return L;
    });

    const key = filterId + individual + next.map(L => L.circles.join(";")).join("|");
    if(key == lastKey) return;
    lastKey = key;
    building = next;
    next.forEach(queueBuild);
}

function queueBuild(L){
    // sorted by x, so each circle only checks the ones within reach on x instead of every turret
    const circles = L.circles.sort((a, b) => a[0] - b[0]);
    let maxR = 0;
    circles.forEach(c => maxR = Math.max(maxR, c[2]));
    circles.forEach((c, i) => {
        if(!individual) jobs.push(() => outlineCircle(L, i, maxR));
        jobs.push(() => fillCircle(L, c));
    });
    // forEach, not for-in: Rhino shares one loop variable between all closures made in a loop
    jobs.push(() => Object.keys(L.rows).forEach(k => jobs.push(() => fillRow(L, k))));
}

// Runs queued jobs until the frame budget is spent; swaps in the new layers once all are done.
function runJobs(){
    const start = Time.nanos();
    while(jobAt < jobs.length && Time.timeSinceNanos(start) < BUDGET_NS) jobs[jobAt++]();
    if(jobAt < jobs.length) return;
    jobs = []; jobAt = 0;
    if(building != null){ layers = building; building = null; }
}

// Fill: union of all circles as horizontal strips, so overlapping circles don't stack their alpha.
function fillCircle(L, c){
    for(let k = Math.floor((c[1] - c[2]) / FILL_ROW); k <= Math.floor((c[1] + c[2]) / FILL_ROW); k++){
        let dy = (k + 0.5) * FILL_ROW - c[1];
        if(Math.abs(dy) >= c[2]) continue;
        let w = Math.sqrt(c[2] * c[2] - dy * dy);
        (L.rows[k] || (L.rows[k] = [])).push([c[0] - w, c[0] + w]);
    }
}

function fillRow(L, k){
    let iv = L.rows[k].sort((a, b) => a[0] - b[0]);
    let s = iv[0][0], e = iv[0][1];
    for(let m = 1; m < iv.length; m++){
        if(iv[m][0] > e){ L.fills.push(s, k * FILL_ROW, e - s); s = iv[m][0]; }
        e = Math.max(e, iv[m][1]);
    }
    L.fills.push(s, k * FILL_ROW, e - s);
}

// plain JS Math only: from JS, Mathf.clamp(x, -1, 1) resolves to the int overload and truncates x to 0
// let, not const, inside loops: the game's Rhino keeps a const at its first-iteration value
// Outline of the union of all circles: for circle i, find the angle ranges covered by
// other circles (exact intersection angles), then draw only the uncovered arcs.
function outlineCircle(L, i, maxR){
    let circles = L.circles, c = circles[i], r = c[2], TAU = Math.PI * 2, covered = [];
    let lo = i;
    while(lo > 0 && c[0] - circles[lo - 1][0] < r + maxR) lo--;

    for(let j = lo; j < circles.length && circles[j][0] - c[0] < r + maxR; j++){
        if(j == i) continue;
        let o = circles[j], R = o[2];
        let dx = o[0] - c[0], dy = o[1] - c[1];
        if(dx * dx + dy * dy >= (r + R) * (r + R)) continue; // apart
        let d = Math.sqrt(dx * dx + dy * dy);
        // c inside o; identical circles: only the first one is drawn
        if(d + r < R || (d + r == R && (r < R || j < i))) return;
        if(d + R <= r) continue; // o sits inside c

        let phi = Math.atan2(dy, dx);
        let alpha = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - R * R) / (2 * r * d))));
        let s = ((phi - alpha) % TAU + TAU) % TAU, e = s + alpha * 2;
        if(e > TAU){ covered.push([s, TAU], [0, e - TAU]); }else{ covered.push([s, e]); }
    }

    // merge covered ranges, then walk the gaps between them
    covered.sort((a, b) => a[0] - b[0]);
    let step = TAU / Math.max(32, Math.min(180, Math.round(r / 2)));
    let at = 0;
    covered.concat([[TAU, TAU]]).forEach(iv => {
        if(iv[0] > at) arc(L.segments, c, at, iv[0], step);
        at = Math.max(at, iv[1]);
    });
}

function arc(segments, c, from, to, step){
    let n = Math.max(1, Math.ceil((to - from) / step));
    let px = c[0] + Math.cos(from) * c[2], py = c[1] + Math.sin(from) * c[2];
    for(let k = 1; k <= n; k++){
        let a = from + (to - from) * k / n;
        let x = c[0] + Math.cos(a) * c[2], y = c[1] + Math.sin(a) * c[2];
        segments.push(px, py, x, y);
        px = x; py = y;
    }
}

function drawLines(L){
    let segments = L.segments;
    if(individual){
        L.circles.forEach(c => Lines.circle(c[0], c[1], c[2]));
    }else{
        for(let i = 0; i < segments.length; i += 4) Lines.line(segments[i], segments[i + 1], segments[i + 2], segments[i + 3]);
    }
}

// Drawn by the game's own minimap code (corner minimap and fullscreen map), already in world coordinates.
const marker = extend(MapObjectives.ObjectiveMarker, {
    draw(scaleFactor){
        if(!enabled) return;
        // world -> screen scale of the current minimap, so lines keep the same pixel width at any zoom
        const px = 1 / Draw.trans().val[0];

        layers.forEach(L => {
            Draw.color(L.color, FILL_ALPHA);
            for(let i = 0; i < L.fills.length; i += 3) Fill.crect(L.fills[i], L.fills[i + 1], L.fills[i + 2], FILL_ROW);
        });

        // dark underlay so the line reads on any terrain
        Draw.color(Pal.darkestGray, 0.8);
        Lines.stroke(Scl.scl(4) * px);
        layers.forEach(drawLines);

        // all underlays first, so one layer's underlay never covers another layer's line
        Lines.stroke(Scl.scl(2) * px);
        layers.forEach(L => {
            Draw.color(L.color);
            drawLines(L);
        });
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

    if(!enabled) return;
    if(jobs.length > 0){
        runJobs();
    }else if(Time.timeSinceMillis(lastRefresh) > REFRESH_MS){
        lastRefresh = Time.millis();
        refresh();
    }
});

// don't show the previous map's turrets on a new one
Events.on(WorldLoadEvent, () => {
    layers = [];
    reset();
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
                    o.button((f.color ? "[#" + f.color + "]" : "") + f.label, Styles.clearTogglet, () => {
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
