/**
 * Canvas star-map engine.
 *
 * Adapted from thunfischtoast/bobiverse-map
 * https://github.com/thunfischtoast/bobiverse-map
 * Copyright (c) 2026 Chris
 * Licensed under Creative Commons Attribution-ShareAlike 4.0 International
 * (https://creativecommons.org/licenses/by-sa/4.0/).
 *
 * Changes from the original (this project):
 * - TypeScript module with injected data payload (our src/data via adapter)
 * - Scoped to books 1–2; book filter via host BookToggle / localStorage
 * - System click → info panel callback (distance, description, Bobs here)
 * - Optional Sol light-year distance rings
 * - Lives under the site Layout header; no standalone config overlay for book
 *   (book comes from bobiverse-book). Layout spread/realistic toggle kept.
 * - Descriptive names and comments on modified sections
 */
import type { StarMapPayload, StarMapBob, StarMapStar } from "../data/starMapAdapter";

export type LayoutMode = "spread" | "realistic";

export interface StarMapEngineOptions {
  root: HTMLElement;
  payload: StarMapPayload;
  /** Called when the user selects a star (or null when cleared). */
  onSelectSystem?: (systemId: string | null, detail: SystemDetail | null) => void;
  /** Initial book spoiler level (1 or 2). */
  initialBook?: 1 | 2;
  /** Draw 10/20/30/40 ly rings from Sol (mostly meaningful in realistic layout). */
  showLyRings?: boolean;
}

export interface SystemDetail {
  id: string;
  name: string;
  distanceLy: number;
  description: string;
  bobNames: string[];
}

interface Vec2 { x: number; y: number }

interface ActiveBob {
  id: string;
  name: string;
  x: number;
  y: number;
  traveling: boolean;
  color: string;
  group: number;
}

export class StarMapEngine {
  private root: HTMLElement;
  private payload: StarMapPayload;
  private onSelectSystem?: StarMapEngineOptions["onSelectSystem"];
  private showLyRings: boolean;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLElement;
  private yearLabel: HTMLElement;
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private speedDisplay: HTMLElement;
  private eventLog: HTMLElement;
  private legend: HTMLElement;
  private layoutBtn: HTMLButtonElement;

  private width = 0;
  private height = 0;
  private mapScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private layoutMode: LayoutMode = "spread";
  private book: 1 | 2 = 1;
  private year: number;
  private playing = false;
  private speed = 2;
  private lastTs: number | null = null;
  private playRaf: number | null = null;

  private starPos3D: Record<string, { x: number; y: number; z: number }> = {};
  private bobColors: Record<string, string> = {};
  private bgStars: { xf: number; yf: number; br: number }[] = [];
  private eventEls: HTMLElement[] = [];

  private filteredStars: Record<string, StarMapStar> = {};
  private filteredBobs: Record<string, StarMapBob> = {};
  private filteredTravels: StarMapPayload["travels"] = [];
  private filteredEvents: StarMapPayload["events"] = [];

  private selectedSystemId: string | null = null;
  private pan: { id: number; x: number; y: number; dragged: boolean } | null = null;
  private viewPanX = 0;
  private viewPanY = 0;
  private viewZoom = 1;

  constructor(options: StarMapEngineOptions) {
    this.root = options.root;
    this.payload = options.payload;
    this.onSelectSystem = options.onSelectSystem;
    this.showLyRings = options.showLyRings !== false;
    this.book = options.initialBook ?? 1;
    this.year = options.payload.yearMin;

    this.canvas = this.root.querySelector("[data-sm-canvas]")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.tooltip = this.root.querySelector("[data-sm-tooltip]")!;
    this.yearLabel = this.root.querySelector("[data-sm-year]")!;
    this.slider = this.root.querySelector("[data-sm-slider]")!;
    this.playBtn = this.root.querySelector("[data-sm-play]")!;
    this.speedDisplay = this.root.querySelector("[data-sm-speed]")!;
    this.eventLog = this.root.querySelector("[data-sm-event-log]")!;
    this.legend = this.root.querySelector("[data-sm-legend]")!;
    this.layoutBtn = this.root.querySelector("[data-sm-layout]")!;

    this.slider.min = String(this.payload.yearMin);
    this.slider.max = String(this.payload.yearMax);
    this.slider.step = "0.1";
    this.slider.value = String(this.payload.yearMin);

    this.precomputeStarPositions();
    this.buildBgStars();
    this.applyScope();
    this.bindChrome();
    this.bindPointer();
    this.resize();
    this.buildEventLog();
    this.buildLegend();
    this.update(this.year);
  }

  /** Host BookToggle calls this when the spoiler level changes. */
  setBook(book: 1 | 2) {
    this.book = book;
    this.applyScope();
    this.resize();
    this.buildEventLog();
    this.buildLegend();
    // Clamp year into still-visible range
    if (this.year > this.payload.yearMax) this.year = this.payload.yearMax;
    this.update(this.year);
  }

  setYear(year: number) {
    this.year = Math.min(this.payload.yearMax, Math.max(this.payload.yearMin, year));
    this.slider.value = String(this.year);
    this.update(this.year);
  }

  clearSelection() {
    this.selectedSystemId = null;
    this.draw(this.year);
    this.emitSelection(null);
  }

  resize = () => {
    const container = this.root.querySelector<HTMLElement>("[data-sm-map]")!;
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fitView();
    this.draw(this.year);
  };

  destroy() {
    this.stopPlay();
    window.removeEventListener("resize", this.onWindowResize);
  }

  // ── Scope (books 1–2) ──────────────────────────────────────────────────────
  private applyScope() {
    this.filteredBobs = {};
    for (const [id, bob] of Object.entries(this.payload.bobs)) {
      if (bob.firstBook <= this.book) this.filteredBobs[id] = bob;
    }
    this.filteredTravels = this.payload.travels.filter((t) => t.firstBook <= this.book);
    this.filteredEvents = this.payload.events
      .filter((e) => e.firstBook <= this.book)
      .sort((a, b) => a.year - b.year);

    // Stars used by visible bobs / travels, plus all stars up to book
    const used = new Set<string>();
    for (const bob of Object.values(this.filteredBobs)) used.add(bob.at);
    for (const t of this.filteredTravels) {
      used.add(t.from);
      used.add(t.to);
    }
    this.filteredStars = {};
    for (const [id, star] of Object.entries(this.payload.stars)) {
      if (star.firstBook <= this.book || used.has(id)) this.filteredStars[id] = star;
    }
    this.computeBobColors();
  }

  // ── Colors (lineage branches — faithful to the reference BRANCH_HUES) ───────
  /** HSL triples keyed by our bob ids for major branches (from reference map). */
  private static readonly BRANCH_HUES: Record<string, [number, number, number]> = {
    bob: [45, 90, 75],
    bill: [210, 70, 65],
    riker: [150, 60, 60],
    milo: [280, 55, 65],
    mario: [20, 75, 65],
    marvin: [320, 50, 60],
    luke: [60, 60, 55],
    bender: [190, 50, 55],
    khan: [35, 65, 55],
    pete: [340, 45, 60],
    victor: [100, 45, 55],
  };

  /** Walk parents until a named branch head (child of Bob or listed hue). */
  private getBranch(bobId: string): string {
    const bob = this.payload.bobs[bobId];
    if (!bob || !bob.parentId) return bobId;
    if (bob.parentId === "bob") return bobId;
    if (StarMapEngine.BRANCH_HUES[bobId]) return bobId;
    return this.getBranch(bob.parentId);
  }

  private computeBobColors() {
    this.bobColors = {};
    for (const id of Object.keys(this.filteredBobs)) {
      if (id === "bob") {
        this.bobColors[id] = "hsl(45 90% 75%)";
        continue;
      }
      const branch = this.getBranch(id);
      const hue = StarMapEngine.BRANCH_HUES[branch] || [0, 50, 60];
      const bob = this.filteredBobs[id];
      const gen = bob.gen ?? 2;
      const genOff = Math.min((gen - 2) * 10, 40);
      this.bobColors[id] = `hsl(${hue[0] + genOff} ${hue[1]}% ${Math.min(hue[2] + genOff * 0.4, 85)}%)`;
    }
  }

  // ── Projection ─────────────────────────────────────────────────────────────
  private precomputeStarPositions() {
    this.starPos3D = {};
    for (const [id, star] of Object.entries(this.payload.stars)) {
      const ra = star.raHours * (Math.PI / 12);
      const dec = star.decDeg * (Math.PI / 180);
      const d = star.distanceLy;
      this.starPos3D[id] = {
        x: d * Math.cos(dec) * Math.cos(ra),
        y: d * Math.cos(dec) * Math.sin(ra),
        z: d * Math.sin(dec),
      };
    }
  }

  private fitView() {
    if (this.layoutMode === "spread") {
      this.mapScale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of Object.keys(this.filteredStars)) {
      const p = this.starPos3D[id];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return;
    const pad = 70;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    this.mapScale = Math.min((this.width - pad * 2) / rangeX, (this.height - pad * 2) / rangeY);
    this.offsetX = this.width / 2 - ((minX + maxX) / 2) * this.mapScale;
    this.offsetY = this.height / 2 + ((minY + maxY) / 2) * this.mapScale;
  }

  private project(x3d: number, y3d: number): Vec2 {
    return {
      x: x3d * this.mapScale * this.viewZoom + this.offsetX + this.viewPanX,
      y: -y3d * this.mapScale * this.viewZoom + this.offsetY + this.viewPanY,
    };
  }

  private projectStar(starId: string): Vec2 | null {
    if (this.layoutMode === "spread") {
      const c = this.payload.customLayout[starId];
      if (c) {
        const pad = 60;
        return {
          x: pad + c.x * (this.width - pad * 2) * this.viewZoom + this.viewPanX + (1 - this.viewZoom) * this.width * 0.5,
          y: pad + c.y * (this.height - pad * 2) * this.viewZoom + this.viewPanY + (1 - this.viewZoom) * this.height * 0.5,
        };
      }
    }
    const p = this.starPos3D[starId];
    if (!p) return null;
    return this.project(p.x, p.y);
  }

  // ── Bob position (core of the reference model) ─────────────────────────────
  private getBobPosition(bobId: string, year: number): Vec2 | null {
    const bob = this.filteredBobs[bobId];
    if (!bob || year < bob.created) return null;
    if (bob.destroyed != null && year > bob.destroyed) return null;

    for (const t of this.filteredTravels) {
      if (t.bobId !== bobId) continue;
      if (year >= t.depart && year <= t.arrive) {
        const frac = (year - t.depart) / (t.arrive - t.depart || 1);
        const fromP = this.projectStar(t.from);
        const toP = this.projectStar(t.to);
        if (!fromP || !toP) continue;
        return {
          x: fromP.x + (toP.x - fromP.x) * frac,
          y: fromP.y + (toP.y - fromP.y) * frac,
        };
      }
    }

    let lastSys = bob.at;
    let lastArr = bob.created;
    for (const t of this.filteredTravels) {
      if (t.bobId !== bobId || t.arrive > year) continue;
      if (t.arrive > lastArr) {
        lastSys = t.to;
        lastArr = t.arrive;
      }
    }
    if (!this.filteredStars[lastSys] && !this.payload.stars[lastSys]) return null;
    return this.projectStar(lastSys);
  }

  private isTraveling(bobId: string, year: number) {
    return this.filteredTravels.find(
      (t) => t.bobId === bobId && year >= t.depart && year <= t.arrive,
    );
  }

  private bobsAtSystem(systemId: string, year: number): string[] {
    const names: string[] = [];
    for (const bob of Object.values(this.filteredBobs)) {
      if (year < bob.created) continue;
      if (bob.destroyed != null && year > bob.destroyed) continue;
      const traveling = this.isTraveling(bob.id, year);
      if (traveling) {
        if (traveling.from === systemId || traveling.to === systemId) {
          names.push(`${bob.name} (in transit)`);
        }
        continue;
      }
      // Settled location = last arrival or initial `at`
      let lastSys = bob.at;
      let lastArr = bob.created;
      for (const t of this.filteredTravels) {
        if (t.bobId !== bob.id || t.arrive > year) continue;
        if (t.arrive > lastArr) {
          lastSys = t.to;
          lastArr = t.arrive;
        }
      }
      if (lastSys === systemId) names.push(bob.name);
    }
    return names;
  }

  // ── Background field stars ─────────────────────────────────────────────────
  private buildBgStars() {
    this.bgStars = [];
    for (let i = 0; i < 150; i++) {
      this.bgStars.push({
        xf: Math.sin(i * 127.1 + 0.5) * 0.5 + 0.5,
        yf: Math.sin(i * 311.7 + 0.3) * 0.5 + 0.5,
        br: 0.06 + (Math.sin(i * 73.3) * 0.5 + 0.5) * 0.14,
      });
    }
  }

  // ── Draw (faithful to reference styling) ───────────────────────────────────
  private draw(year: number) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    ctx.clearRect(0, 0, W, H);

    for (const s of this.bgStars) {
      ctx.fillStyle = `rgba(140,160,200,${s.br})`;
      ctx.fillRect(s.xf * W, s.yf * H, 1, 1);
    }

    // Sol ly rings (addition) — use realistic 3D distance in both layouts by
    // projecting a circle in the XY plane around Sol when in realistic mode;
    // in spread mode, draw approximate rings scaled from Sol→Epsilon Eridani.
    if (this.showLyRings) {
      this.drawLyRings(ctx);
    }

    // Travel dashed lines
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const t of this.filteredTravels) {
      if (year < t.depart || year > t.arrive) continue;
      const c = this.bobColors[t.bobId];
      if (!c) continue;
      const fromP = this.projectStar(t.from);
      const toP = this.projectStar(t.to);
      if (!fromP || !toP) continue;
      ctx.strokeStyle = c.replace("hsl(", "hsla(").replace(")", ", 0.3)");
      ctx.beginPath();
      ctx.moveTo(fromP.x, fromP.y);
      ctx.lineTo(toP.x, toP.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Stars
    for (const id of Object.keys(this.filteredStars)) {
      const p = this.projectStar(id);
      if (!p) continue;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18);
      grad.addColorStop(0, "rgba(100,140,220,0.12)");
      grad.addColorStop(1, "rgba(100,140,220,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
      ctx.fill();

      const isSelected = id === this.selectedSystemId;
      ctx.fillStyle = isSelected ? "#e0c878" : "#5a7aaa";
      ctx.beginPath();
      ctx.arc(p.x, p.y, isSelected ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#3a5070";
      ctx.font = "9px Consolas, Monaco, monospace";
      ctx.textAlign = "center";
      ctx.fillText(this.filteredStars[id].name, p.x, p.y + 16);
    }

    // Bobs + cluster labels
    const active: ActiveBob[] = [];
    for (const bob of Object.values(this.filteredBobs)) {
      const pos = this.getBobPosition(bob.id, year);
      if (!pos) continue;
      active.push({
        id: bob.id,
        name: bob.name,
        x: pos.x,
        y: pos.y,
        traveling: Boolean(this.isTraveling(bob.id, year)),
        color: this.bobColors[bob.id],
        group: bob.group ?? 0,
      });
    }

    const clusters: ActiveBob[][] = [];
    const used: Record<number, boolean> = {};
    for (let i = 0; i < active.length; i++) {
      if (used[i]) continue;
      const cl = [active[i]];
      used[i] = true;
      for (let j = i + 1; j < active.length; j++) {
        if (used[j]) continue;
        const dx = active[i].x - active[j].x;
        const dy = active[i].y - active[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < 20) {
          cl.push(active[j]);
          used[j] = true;
        }
      }
      clusters.push(cl);
    }

    for (const cl of clusters) {
      for (const b of cl) {
        const r = b.group ? 7 : 5;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (b.group) {
          ctx.fillStyle = "#0a0e1a";
          ctx.font = "bold 8px Consolas, Monaco, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`+${b.group}`, b.x, b.y + 3);
        }
        if (b.traveling) {
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      const cx = cl[0].x;
      const cy = cl[0].y;
      ctx.font = "10px Consolas, Monaco, monospace";
      ctx.textAlign = "left";
      const startY = cy - (cl.length - 1) * 6;
      for (let i = 0; i < cl.length; i++) {
        ctx.fillStyle = cl[i].color;
        const label = cl[i].name + (cl[i].traveling ? " >>" : "");
        ctx.fillText(label, cx + 10, startY + i * 13);
      }
    }
  }

  /** 10/20/30/40 ly rings centered on Sol (addition on top of the reference). */
  private drawLyRings(ctx: CanvasRenderingContext2D) {
    const sol = this.projectStar("sol");
    if (!sol) return;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(58,80,112,0.45)";
    ctx.fillStyle = "rgba(58,80,112,0.7)";
    ctx.font = "9px Consolas, Monaco, monospace";
    ctx.textAlign = "left";

    for (const ly of [10, 20, 30, 40]) {
      let radiusPx: number;
      if (this.layoutMode === "realistic") {
        // Project a point `ly` light-years along +X from Sol in the same projection.
        const edge = this.project(ly, 0);
        radiusPx = Math.hypot(edge.x - sol.x, edge.y - sol.y);
      } else {
        // Spread layout is not to scale; approximate using Sol→Epsilon Eridani screen distance.
        const ee = this.projectStar("epsilon-eridani");
        if (!ee) continue;
        const eeDist = Math.hypot(ee.x - sol.x, ee.y - sol.y);
        const eeLy = this.payload.stars["epsilon-eridani"]?.distanceLy || 10.5;
        radiusPx = (eeDist / eeLy) * ly;
      }
      ctx.beginPath();
      ctx.arc(sol.x, sol.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${ly} ly`, sol.x + radiusPx * 0.72, sol.y - radiusPx * 0.72);
    }
    ctx.restore();
  }

  // ── Event log / legend ─────────────────────────────────────────────────────
  private buildEventLog() {
    this.eventLog.replaceChildren();
    this.eventEls = [];
    for (const ev of this.filteredEvents) {
      const el = document.createElement("div");
      el.className = "event-item future";
      const ys = document.createElement("span");
      ys.className = "event-year";
      ys.textContent = String(Math.floor(ev.year));
      el.appendChild(ys);
      if (ev.destroyed) {
        const ds = document.createElement("span");
        ds.className = "event-destroyed";
        ds.textContent = ev.text;
        el.appendChild(ds);
      } else if (ev.bobId && this.filteredBobs[ev.bobId]) {
        const bs = document.createElement("span");
        bs.className = "event-bob";
        bs.textContent = `${this.filteredBobs[ev.bobId].name}: `;
        el.appendChild(bs);
        el.appendChild(document.createTextNode(ev.text));
      } else {
        el.appendChild(document.createTextNode(ev.text));
      }
      this.eventLog.appendChild(el);
      this.eventEls.push(el);
    }
  }

  private updateEventLog(year: number) {
    let activeIdx = -1;
    for (let i = 0; i < this.filteredEvents.length; i++) {
      const ev = this.filteredEvents[i];
      const el = this.eventEls[i];
      if (!el) continue;
      if (ev.year <= year) {
        el.className = "event-item past";
        activeIdx = i;
      } else {
        el.className = "event-item future";
      }
    }
    if (activeIdx >= 0 && this.eventEls[activeIdx]) {
      this.eventEls[activeIdx].className = "event-item active";
      this.eventEls[activeIdx].scrollIntoView({ block: "nearest" });
    }
  }

  private buildLegend() {
    this.legend.replaceChildren();
    const heads = ["bob", "bill", "riker", "milo", "mario"];
    for (const id of heads) {
      if (!this.filteredBobs[id]) continue;
      const item = document.createElement("div");
      item.className = "legend-item";
      item.style.display = "inline-flex";
      item.style.alignItems = "center";
      item.style.gap = "4px";
      item.style.marginRight = "12px";
      const dot = document.createElement("span");
      dot.style.width = "8px";
      dot.style.height = "8px";
      dot.style.borderRadius = "50%";
      dot.style.background = this.bobColors[id] || "#5a7aaa";
      dot.style.display = "inline-block";
      item.appendChild(dot);
      item.appendChild(document.createTextNode(this.filteredBobs[id].name));
      this.legend.appendChild(item);
    }
  }

  // ── Update / playback ──────────────────────────────────────────────────────
  private update(year: number) {
    this.year = year;
    this.yearLabel.textContent = String(Math.floor(year));
    this.draw(year);
    this.updateEventLog(year);
    if (this.selectedSystemId) {
      this.emitSelection(this.selectedSystemId);
    }
  }

  private stopPlay() {
    this.playing = false;
    this.playBtn.textContent = "Play";
    if (this.playRaf != null) {
      cancelAnimationFrame(this.playRaf);
      this.playRaf = null;
    }
  }

  private tick = (ts: number) => {
    if (!this.playing) return;
    if (this.lastTs != null) {
      const dt = (ts - this.lastTs) / 1000;
      let val = this.year + dt * this.speed;
      if (val >= this.payload.yearMax) {
        val = this.payload.yearMax;
        this.slider.value = String(val);
        this.update(val);
        this.stopPlay();
        return;
      }
      this.slider.value = String(val);
      this.update(val);
    }
    this.lastTs = ts;
    this.playRaf = requestAnimationFrame(this.tick);
  };

  // ── Selection ──────────────────────────────────────────────────────────────
  private emitSelection(systemId: string | null) {
    if (!systemId || !this.filteredStars[systemId]) {
      this.onSelectSystem?.(null, null);
      return;
    }
    const star = this.filteredStars[systemId];
    this.onSelectSystem?.(systemId, {
      id: systemId,
      name: star.name,
      distanceLy: star.distanceLy,
      description: star.description,
      bobNames: this.bobsAtSystem(systemId, this.year),
    });
  }

  private selectSystemAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: string | null = null;
    let bestDist = 16; // generous hit radius in CSS pixels
    for (const id of Object.keys(this.filteredStars)) {
      const p = this.projectStar(id);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    this.selectedSystemId = best;
    this.draw(this.year);
    this.emitSelection(best);
  }

  // ── Chrome bindings ────────────────────────────────────────────────────────
  private onWindowResize = () => {
    this.resize();
    this.update(this.year);
  };

  private bindChrome() {
    this.slider.addEventListener("input", () => {
      this.stopPlay();
      this.update(parseFloat(this.slider.value));
    });

    this.playBtn.addEventListener("click", () => {
      this.playing = !this.playing;
      this.playBtn.textContent = this.playing ? "Pause" : "Play";
      this.lastTs = null;
      if (this.playing) this.playRaf = requestAnimationFrame(this.tick);
    });

    this.layoutBtn.addEventListener("click", () => {
      this.layoutMode = this.layoutMode === "realistic" ? "spread" : "realistic";
      this.layoutBtn.textContent =
        "Layout: " + (this.layoutMode === "realistic" ? "Realistic" : "Spread");
      this.viewPanX = 0;
      this.viewPanY = 0;
      this.viewZoom = 1;
      this.fitView();
      this.update(this.year);
    });

    window.addEventListener("resize", this.onWindowResize);

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") {
        this.speed = Math.min(this.speed * 1.5, 20);
        this.speedDisplay.textContent = `${this.speed.toFixed(1)} yr/s`;
      }
      if (e.key === "-") {
        this.speed = Math.max(this.speed / 1.5, 0.5);
        this.speedDisplay.textContent = `${this.speed.toFixed(1)} yr/s`;
      }
      if (e.key === " ") {
        e.preventDefault();
        this.playBtn.click();
      }
      if (e.key === "ArrowRight") {
        this.stopPlay();
        this.setYear(this.year + 1);
      }
      if (e.key === "ArrowLeft") {
        this.stopPlay();
        this.setYear(this.year - 1);
      }
      if (e.key === "Escape") {
        this.selectedSystemId = null;
        this.draw(this.year);
        this.emitSelection(null);
      }
    });
  }

  /**
   * Pan / zoom / click. Click vs drag uses a movement threshold so selection
   * works (same class of bug we hit in the SVG map).
   */
  private bindPointer() {
    const DRAG_PX = 5;

    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.pan || e.pointerId !== this.pan.id) return;
      const dx = e.clientX - this.pan.x;
      const dy = e.clientY - this.pan.y;
      if (!this.pan.dragged && Math.hypot(dx, dy) > DRAG_PX) {
        this.pan.dragged = true;
        this.canvas.setPointerCapture(e.pointerId);
      }
      if (!this.pan.dragged) return;
      this.viewPanX += e.clientX - this.pan.x;
      this.viewPanY += e.clientY - this.pan.y;
      this.pan.x = e.clientX;
      this.pan.y = e.clientY;
      this.draw(this.year);

      // Tooltip while idle is handled below; hide while dragging
      this.tooltip.style.display = "none";
    });

    const end = (e: PointerEvent) => {
      if (!this.pan || e.pointerId !== this.pan.id) return;
      const wasDrag = this.pan.dragged;
      if (wasDrag && this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.pan = null;
      if (!wasDrag) this.selectSystemAt(e.clientX, e.clientY);
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.viewZoom = Math.min(3.5, Math.max(0.45, this.viewZoom * factor));
        this.draw(this.year);
      },
      { passive: false },
    );

    this.canvas.addEventListener("mousemove", (e) => {
      if (this.pan?.dragged) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let tip = "";
      for (const id of Object.keys(this.filteredStars)) {
        const p = this.projectStar(id);
        if (!p) continue;
        if (Math.hypot(p.x - x, p.y - y) < 12) {
          const s = this.filteredStars[id];
          tip = `${s.name} · ${s.distanceLy.toFixed(2)} ly`;
          break;
        }
      }
      if (!tip) {
        for (const bob of Object.values(this.filteredBobs)) {
          const p = this.getBobPosition(bob.id, this.year);
          if (!p) continue;
          if (Math.hypot(p.x - x, p.y - y) < 10) {
            tip = bob.name + (this.isTraveling(bob.id, this.year) ? " (in transit)" : "");
            break;
          }
        }
      }
      if (tip) {
        this.tooltip.style.display = "block";
        this.tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        this.tooltip.style.top = `${e.clientY - rect.top + 12}px`;
        this.tooltip.textContent = tip;
      } else {
        this.tooltip.style.display = "none";
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.tooltip.style.display = "none";
    });
  }
}
