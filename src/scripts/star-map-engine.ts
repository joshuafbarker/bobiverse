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
 * - TypeScript module; data injected from our Astro build-time adapter
 * - Books 1–2 only; spoiler level via host BookToggle (`bobiverse-book`)
 * - System click → info panel (host markup); Sol ly rings
 * - Event log / legend / panel shells are Astro markup — this module only
 *   toggles classes/attributes and draws the canvas (no innerHTML)
 * - On narrow canvases, crowded Bob name stacks collapse to "Name +N"
 */
import type { StarMapPayload, StarMapBob, StarMapStar } from "../data/starMapAdapter";

export type LayoutMode = "spread" | "realistic";

export interface SystemDetail {
  id: string;
  name: string;
  distanceLy: number;
  description: string;
  /** Bob ids currently at / related to this system (for showing prebuilt rows). */
  bobIds: string[];
  /** Parallel display labels (may include " (in transit)"). */
  bobLabels: string[];
}

export interface StarMapEngineOptions {
  root: HTMLElement;
  payload: StarMapPayload;
  onSelectSystem?: (systemId: string | null, detail: SystemDetail | null) => void;
  /** Fired after year/book changes so the host can sync panel Bob rows. */
  onFrame?: (year: number, book: 1 | 2) => void;
  initialBook?: 1 | 2;
  showLyRings?: boolean;
}

interface Vec2 {
  x: number;
  y: number;
}

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
  private onFrame?: StarMapEngineOptions["onFrame"];
  private showLyRings: boolean;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLElement;
  private yearLabel: HTMLElement;
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private speedDisplay: HTMLElement;
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

  private filteredStars: Record<string, StarMapStar> = {};
  private filteredBobs: Record<string, StarMapBob> = {};
  private filteredTravels: StarMapPayload["travels"] = [];

  private selectedSystemId: string | null = null;
  private pan: { id: number; x: number; y: number; dragged: boolean } | null = null;
  private viewPanX = 0;
  private viewPanY = 0;
  private viewZoom = 1;

  constructor(options: StarMapEngineOptions) {
    this.root = options.root;
    this.payload = options.payload;
    this.onSelectSystem = options.onSelectSystem;
    this.onFrame = options.onFrame;
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
    this.layoutBtn = this.root.querySelector("[data-sm-layout]")!;

    this.precomputeStarPositions();
    this.buildBgStars();
    this.applyScope();
    this.bindChrome();
    this.bindPointer();
    this.resize();
    this.update(this.year);
  }

  setBook(book: 1 | 2) {
    this.book = book;
    this.applyScope();
    this.syncBookScopedDom();
    this.fitView();
    this.update(this.year);
  }

  setYear(year: number) {
    this.year = Math.min(this.payload.yearMax, Math.max(this.payload.yearMin, year));
    this.slider.value = String(this.year);
    this.update(this.year);
  }

  getYear() {
    return this.year;
  }

  getBook() {
    return this.book;
  }

  clearSelection() {
    this.selectedSystemId = null;
    this.draw(this.year);
    this.emitSelection(null);
  }

  /** Public hit-test helper used by verification scripts. */
  projectStar(starId: string): Vec2 | null {
    return this.projectStarInternal(starId);
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

  // ── Scope ──────────────────────────────────────────────────────────────────
  private applyScope() {
    this.filteredBobs = {};
    for (const [id, bob] of Object.entries(this.payload.bobs)) {
      if (bob.firstBook <= this.book) this.filteredBobs[id] = bob;
    }
    this.filteredTravels = this.payload.travels.filter((t) => t.firstBook <= this.book);

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

  /**
   * Hide/show pre-rendered event rows and legend items by firstBook.
   * Event past/active/future classes are applied in syncEventLog().
   */
  private syncBookScopedDom() {
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-event-item]")) {
      const firstBook = Number(el.dataset.firstBook ?? 1);
      el.classList.toggle("hidden", firstBook > this.book);
    }
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-legend-item]")) {
      const firstBook = Number(el.dataset.firstBook ?? 1);
      el.classList.toggle("hidden", firstBook > this.book);
    }
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-bob-row]")) {
      const firstBook = Number(el.dataset.firstBook ?? 1);
      // Book filter is applied; year/system visibility is handled by the host.
      el.dataset.bookVisible = firstBook <= this.book ? "1" : "0";
    }
  }

  private syncEventLog(year: number) {
    let activeEl: HTMLElement | null = null;
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-event-item]")) {
      if (el.classList.contains("hidden")) continue;
      const eventYear = Number(el.dataset.year);
      el.classList.remove("is-past", "is-active", "is-future");
      if (eventYear <= year) {
        el.classList.add("is-past");
        activeEl = el;
      } else {
        el.classList.add("is-future");
      }
    }
    if (activeEl) {
      activeEl.classList.remove("is-past");
      activeEl.classList.add("is-active");
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Colors ─────────────────────────────────────────────────────────────────
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
      const gen = this.filteredBobs[id].gen ?? 2;
      const genOff = Math.min((gen - 2) * 10, 40);
      this.bobColors[id] =
        `hsl(${hue[0] + genOff} ${hue[1]}% ${Math.min(hue[2] + genOff * 0.4, 85)}%)`;
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
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const id of Object.keys(this.filteredStars)) {
      const p = this.starPos3D[id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
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

  private projectStarInternal(starId: string): Vec2 | null {
    if (this.layoutMode === "spread") {
      const c = this.payload.customLayout[starId];
      if (c) {
        const pad = 60;
        return {
          x:
            pad +
            c.x * (this.width - pad * 2) * this.viewZoom +
            this.viewPanX +
            (1 - this.viewZoom) * this.width * 0.5,
          y:
            pad +
            c.y * (this.height - pad * 2) * this.viewZoom +
            this.viewPanY +
            (1 - this.viewZoom) * this.height * 0.5,
        };
      }
    }
    const p = this.starPos3D[starId];
    if (!p) return null;
    return this.project(p.x, p.y);
  }

  // ── Bob positions ──────────────────────────────────────────────────────────
  private getBobPosition(bobId: string, year: number): Vec2 | null {
    const bob = this.filteredBobs[bobId];
    if (!bob || year < bob.created) return null;
    if (bob.destroyed != null && year > bob.destroyed) return null;

    for (const t of this.filteredTravels) {
      if (t.bobId !== bobId) continue;
      if (year >= t.depart && year <= t.arrive) {
        const frac = (year - t.depart) / (t.arrive - t.depart || 1);
        const fromP = this.projectStarInternal(t.from);
        const toP = this.projectStarInternal(t.to);
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
    return this.projectStarInternal(lastSys);
  }

  private isTraveling(bobId: string, year: number) {
    return this.filteredTravels.find(
      (t) => t.bobId === bobId && year >= t.depart && year <= t.arrive,
    );
  }

  /** Which Bobs belong in the system panel for the current year. */
  bobsAtSystem(systemId: string, year = this.year): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    for (const bob of Object.values(this.filteredBobs)) {
      if (year < bob.created) continue;
      if (bob.destroyed != null && year > bob.destroyed) continue;
      const traveling = this.isTraveling(bob.id, year);
      if (traveling) {
        if (traveling.from === systemId || traveling.to === systemId) {
          out.push({ id: bob.id, label: `${bob.name} (in transit)` });
        }
        continue;
      }
      let lastSys = bob.at;
      let lastArr = bob.created;
      for (const t of this.filteredTravels) {
        if (t.bobId !== bob.id || t.arrive > year) continue;
        if (t.arrive > lastArr) {
          lastSys = t.to;
          lastArr = t.arrive;
        }
      }
      if (lastSys === systemId) out.push({ id: bob.id, label: bob.name });
    }
    return out;
  }

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

  // ── Draw ───────────────────────────────────────────────────────────────────
  private draw(year: number) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    ctx.clearRect(0, 0, W, H);

    for (const s of this.bgStars) {
      ctx.fillStyle = `rgba(140,160,200,${s.br})`;
      ctx.fillRect(s.xf * W, s.yf * H, 1, 1);
    }

    if (this.showLyRings) this.drawLyRings(ctx);

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const t of this.filteredTravels) {
      if (year < t.depart || year > t.arrive) continue;
      const c = this.bobColors[t.bobId];
      if (!c) continue;
      const fromP = this.projectStarInternal(t.from);
      const toP = this.projectStarInternal(t.to);
      if (!fromP || !toP) continue;
      ctx.strokeStyle = c.replace("hsl(", "hsla(").replace(")", ", 0.3)");
      ctx.beginPath();
      ctx.moveTo(fromP.x, fromP.y);
      ctx.lineTo(toP.x, toP.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    for (const id of Object.keys(this.filteredStars)) {
      const p = this.projectStarInternal(id);
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

      // System labels: brighter + slightly larger than the reference's dim
      // 9px/#3a5070, with a dark halo so they stay readable over rings/lines.
      // Font size is in CSS pixels (DPR transform), so zoom does not balloon text.
      ctx.font = "11px Consolas, Monaco, monospace";
      ctx.textAlign = "center";
      const label = this.filteredStars[id].name;
      const labelY = p.y + 17;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(10, 14, 26, 0.85)";
      ctx.strokeText(label, p.x, labelY);
      ctx.fillStyle = "#b4c4dc";
      ctx.fillText(label, p.x, labelY);
    }

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

    // Narrow canvases (phones): collapse long name stacks so Sol doesn't pile up.
    const compactLabels = W < 520 || (W < 720 && this.viewZoom < 1.15);

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

      if (compactLabels && cl.length > 2) {
        // Show first name + count chip; zoom in or use desktop for full stack.
        const first = cl[0];
        const extra = cl.length - 1;
        ctx.fillStyle = first.color;
        const suffix = first.traveling ? " >>" : "";
        ctx.fillText(`${first.name}${suffix} +${extra}`, cx + 10, cy + 3);
      } else {
        const startY = cy - (cl.length - 1) * 6;
        for (let i = 0; i < cl.length; i++) {
          ctx.fillStyle = cl[i].color;
          const label = cl[i].name + (cl[i].traveling ? " >>" : "");
          ctx.fillText(label, cx + 10, startY + i * 13);
        }
      }
    }
  }

  private drawLyRings(ctx: CanvasRenderingContext2D) {
    const sol = this.projectStarInternal("sol");
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
        const edge = this.project(ly, 0);
        radiusPx = Math.hypot(edge.x - sol.x, edge.y - sol.y);
      } else {
        const ee = this.projectStarInternal("epsilon-eridani");
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

  // ── Update / playback ──────────────────────────────────────────────────────
  private update(year: number) {
    this.year = year;
    this.yearLabel.textContent = String(Math.floor(year));
    this.draw(year);
    this.syncEventLog(year);
    this.syncBookScopedDom();
    if (this.selectedSystemId) this.emitSelection(this.selectedSystemId);
    this.onFrame?.(year, this.book);
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

  private emitSelection(systemId: string | null) {
    if (!systemId || !this.filteredStars[systemId]) {
      this.onSelectSystem?.(null, null);
      return;
    }
    const star = this.filteredStars[systemId];
    const present = this.bobsAtSystem(systemId, this.year);
    this.onSelectSystem?.(systemId, {
      id: systemId,
      name: star.name,
      distanceLy: star.distanceLy,
      description: star.description,
      bobIds: present.map((p) => p.id),
      bobLabels: present.map((p) => p.label),
    });
  }

  private selectSystemAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: string | null = null;
    let bestDist = 16;
    for (const id of Object.keys(this.filteredStars)) {
      const p = this.projectStarInternal(id);
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

  // ── Chrome ─────────────────────────────────────────────────────────────────
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
      if (e.key === "Escape") this.clearSelection();
    });
  }

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
        const p = this.projectStarInternal(id);
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
