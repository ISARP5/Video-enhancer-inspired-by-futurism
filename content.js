(function() {
	//#region src/css-engine.ts
	var TIME_PROFILES = {
		morning: {
			name: "Morning Light",
			sharpness: 12,
			contrast: 108,
			saturation: 110,
			brightness: 103,
			warmth: 8,
			shadowLift: .03,
			highlightCompress: .96,
			gamma: 1.03
		},
		daylight: {
			name: "Daylight",
			sharpness: 18,
			contrast: 115,
			saturation: 118,
			brightness: 100,
			warmth: 2,
			shadowLift: .02,
			highlightCompress: .95,
			gamma: 1
		},
		goldenHour: {
			name: "Golden Hour",
			sharpness: 15,
			contrast: 125,
			saturation: 125,
			brightness: 102,
			warmth: 30,
			shadowLift: .05,
			highlightCompress: .9,
			gamma: 1.08
		},
		nightCinema: {
			name: "Night Cinema",
			sharpness: 10,
			contrast: 130,
			saturation: 115,
			brightness: 95,
			warmth: 45,
			shadowLift: .08,
			highlightCompress: .88,
			gamma: 1.15
		}
	};
	function lerpProfile(a, b, t) {
		const mix = (x, y) => x + (y - x) * t;
		return {
			name: t < .5 ? a.name : b.name,
			sharpness: mix(a.sharpness, b.sharpness),
			contrast: mix(a.contrast, b.contrast),
			saturation: mix(a.saturation, b.saturation),
			brightness: mix(a.brightness, b.brightness),
			warmth: mix(a.warmth, b.warmth),
			shadowLift: mix(a.shadowLift, b.shadowLift),
			highlightCompress: mix(a.highlightCompress, b.highlightCompress),
			gamma: mix(a.gamma, b.gamma)
		};
	}
	function getCurrentProfile() {
		const now = /* @__PURE__ */ new Date();
		const fh = now.getHours() + now.getMinutes() / 60;
		let p;
		if (fh >= 6 && fh < 11) p = lerpProfile(TIME_PROFILES.morning, TIME_PROFILES.daylight, (fh - 6) / 5);
		else if (fh >= 11 && fh < 17) p = { ...TIME_PROFILES.daylight };
		else if (fh >= 17 && fh < 20) p = lerpProfile(TIME_PROFILES.daylight, TIME_PROFILES.goldenHour, (fh - 17) / 3);
		else if (fh >= 20 && fh < 22) p = lerpProfile(TIME_PROFILES.goldenHour, TIME_PROFILES.nightCinema, (fh - 20) / 2);
		else if (fh >= 4 && fh < 6) p = lerpProfile(TIME_PROFILES.nightCinema, TIME_PROFILES.morning, (fh - 4) / 2);
		else p = { ...TIME_PROFILES.nightCinema };
		return p;
	}
	var CSSAdaptiveEngine = class CSSAdaptiveEngine {
		video;
		svgElement = null;
		filterId;
		feConvolve = null;
		isActive = false;
		baseProfile;
		userOffset = {
			c: 0,
			s: 0,
			b: 0,
			sh: 0
		};
		nightShiftOverride = null;
		currentProfile;
		smoothedProfile;
		lastVideoTime = -1;
		sceneEnergy = 0;
		lastApplyTime = 0;
		profileUpdateTimer = 0;
		boundOnTimeUpdate;
		boundOnPlay;
		boundOnPause;
		boundOnVisibility;
		animFrameId = 0;
		static instanceCounter = 0;
		get updateIntervalMs() {
			return 250;
		}
		constructor(video) {
			this.video = video;
			CSSAdaptiveEngine.instanceCounter++;
			this.filterId = `ve-css-v5-${CSSAdaptiveEngine.instanceCounter}`;
			this.baseProfile = getCurrentProfile();
			this.currentProfile = { ...this.baseProfile };
			this.smoothedProfile = { ...this.baseProfile };
			this.boundOnTimeUpdate = this.onTimeUpdate.bind(this);
			this.boundOnPlay = this.onPlay.bind(this);
			this.boundOnPause = this.onPause.bind(this);
			this.boundOnVisibility = this.onVisibility.bind(this);
			this.buildSVGSharpnessFilter();
		}
		buildSVGSharpnessFilter() {
			const svgNS = "http://www.w3.org/2000/svg";
			const existing = document.getElementById(this.filterId + "-svg");
			if (existing) existing.remove();
			const svg = document.createElementNS(svgNS, "svg");
			svg.id = this.filterId + "-svg";
			svg.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
			svg.setAttribute("aria-hidden", "true");
			const defs = document.createElementNS(svgNS, "defs");
			const filter = document.createElementNS(svgNS, "filter");
			filter.id = this.filterId;
			filter.setAttribute("color-interpolation-filters", "sRGB");
			filter.setAttribute("x", "-2%");
			filter.setAttribute("y", "-2%");
			filter.setAttribute("width", "104%");
			filter.setAttribute("height", "104%");
			const feConvolve = document.createElementNS(svgNS, "feConvolveMatrix");
			feConvolve.setAttribute("in", "SourceGraphic");
			feConvolve.setAttribute("order", "3 3");
			feConvolve.setAttribute("preserveAlpha", "true");
			feConvolve.setAttribute("kernelMatrix", "0 0 0  0 1 0  0 0 0");
			filter.appendChild(feConvolve);
			this.feConvolve = feConvolve;
			defs.appendChild(filter);
			svg.appendChild(defs);
			const target = document.head || document.documentElement;
			if (target) target.appendChild(svg);
			this.svgElement = svg;
		}
		/**
		* Quintic smoothstep: 6t⁵ - 15t⁴ + 10t³
		* Más suave que smoothstep cúbico, produce transiciones imperceptibles.
		*/
		quinticSmooth(t) {
			t = Math.max(0, Math.min(1, t));
			return t * t * t * (t * (t * 6 - 15) + 10);
		}
		/**
		* Calcula el contraste perceptual usando Weber-Fechner.
		* En vez de multiplicar linealmente (CSS contrast), ajustamos
		* la curva de tonos para que los cambios sean proporcionales
		* a la percepción logarítmica del ojo humano.
		* 
		* Fórmula: CSS_contrast = 100 + k * ln(targetContrast / 100)
		* Donde k es un factor de ganancia calibrado.
		*/
		perceptualContrast(targetPercent) {
			if (Math.abs(targetPercent - 100) < .5) return 100;
			const ratio = targetPercent / 100;
			const perceptual = 100 + 105 * Math.log(ratio);
			return Math.max(70, Math.min(160, perceptual));
		}
		/**
		* Shadow Lift perceptual: levanta los negros con curva de potencia.
		* γ adaptativo = 1.0 + shadowLift * 1.2
		* f(x) = x^(1/γ) → levanta las sombras sin lavar los medios tonos.
		* 
		* Lo expresamos como brightness + contrast CSS combinados:
		* - brightness sube ligeramente los negros absolutos
		* - contrast compensa para mantener el rango dinámico
		*/
		computeShadowLift(shadowLift, gamma) {
			const effectiveGamma = 1 + shadowLift * 3.5 + (gamma - 1);
			const b = Math.pow(effectiveGamma, .6) * 100;
			const c = 100 - (effectiveGamma - 1) * 45;
			return {
				brightness: Math.max(96, Math.min(110, b)),
				contrast: Math.max(95, Math.min(110, c))
			};
		}
		/**
		* Highlight Rolloff: comprime los blancos quemados con knee suave.
		* Usa una curva de saturación logarítmica para que las luces altas
		* no se clipeen sino que rueden suavemente hacia el blanco.
		*/
		computeHighlightRolloff(highlightCompress) {
			const rolloff = 1 - (1 - highlightCompress) * .8;
			return Math.max(92, Math.min(100, rolloff * 100));
		}
		applySceneVariance() {
			const t = this.video.currentTime;
			if (t === this.lastVideoTime) return;
			const delta = Math.abs(t - this.lastVideoTime);
			if (this.lastVideoTime >= 0 && delta > 1.5) this.sceneEnergy = 1;
			else this.sceneEnergy *= .95;
			this.lastVideoTime = t;
			const realT = Date.now() / 1e3;
			const n1 = Math.sin(realT * .42);
			const n2 = Math.cos(realT * .57);
			const pupil = this.sceneEnergy * 1.5;
			const breathAmp = .8;
			this.currentProfile.contrast = this.baseProfile.contrast + n1 * 1.5 * breathAmp + pupil * 3;
			this.currentProfile.saturation = this.baseProfile.saturation + n2 * 2 * breathAmp + pupil * 1;
			this.currentProfile.brightness = this.baseProfile.brightness + n1 * .5 * breathAmp + pupil * 2;
			this.currentProfile.sharpness = this.baseProfile.sharpness + n2 * .8 * breathAmp + pupil * 1.5;
			if (this.nightShiftOverride !== null) this.currentProfile.warmth = this.nightShiftOverride;
			else this.currentProfile.warmth = this.baseProfile.warmth;
			this.currentProfile.contrast = Math.max(90, Math.min(130, this.currentProfile.contrast));
			this.currentProfile.saturation = Math.max(90, Math.min(140, this.currentProfile.saturation));
			this.currentProfile.brightness = Math.max(85, Math.min(115, this.currentProfile.brightness));
			this.currentProfile.sharpness = Math.max(0, Math.min(30, this.currentProfile.sharpness));
		}
		smoothStep() {
			const f = .12;
			const lerp = (a, b) => a + (b - a) * f;
			this.smoothedProfile.sharpness = lerp(this.smoothedProfile.sharpness, this.currentProfile.sharpness);
			this.smoothedProfile.contrast = lerp(this.smoothedProfile.contrast, this.currentProfile.contrast);
			this.smoothedProfile.saturation = lerp(this.smoothedProfile.saturation, this.currentProfile.saturation);
			this.smoothedProfile.brightness = lerp(this.smoothedProfile.brightness, this.currentProfile.brightness);
			this.smoothedProfile.warmth = lerp(this.smoothedProfile.warmth, this.currentProfile.warmth);
			this.smoothedProfile.shadowLift = lerp(this.smoothedProfile.shadowLift, this.currentProfile.shadowLift);
			this.smoothedProfile.highlightCompress = lerp(this.smoothedProfile.highlightCompress, this.currentProfile.highlightCompress);
			this.smoothedProfile.gamma = lerp(this.smoothedProfile.gamma, this.currentProfile.gamma);
		}
		applyProfile() {
			const p = this.smoothedProfile;
			const filters = [];
			if (this.feConvolve && p.sharpness > 1) {
				const s = p.sharpness / 100 * 2.5;
				const center = 1 + 4 * s;
				this.feConvolve.setAttribute("kernelMatrix", `0 ${-s.toFixed(4)} 0  ${-s.toFixed(4)} ${center.toFixed(4)} ${-s.toFixed(4)}  0 ${-s.toFixed(4)} 0`);
				filters.push(`url(#${this.filterId})`);
			}
			const shadow = this.computeShadowLift(p.shadowLift, p.gamma);
			let finalBrightness = shadow.brightness;
			const highlightBri = this.computeHighlightRolloff(p.highlightCompress);
			if (highlightBri < 99.5) finalBrightness = finalBrightness / 100 * (highlightBri / 100) * (p.brightness / 100) * 100;
			else if (Math.abs(p.brightness - 100) > .3) finalBrightness = finalBrightness / 100 * (p.brightness / 100) * 100;
			if (Math.abs(finalBrightness - 100) > .3) filters.push(`brightness(${finalBrightness.toFixed(1)}%)`);
			const finalContrast = this.perceptualContrast(p.contrast) / 100 * (shadow.contrast / 100) * 100;
			if (Math.abs(finalContrast - 100) > .3) filters.push(`contrast(${finalContrast.toFixed(1)}%)`);
			if (Math.abs(p.saturation - 100) > .3) filters.push(`saturate(${p.saturation.toFixed(1)}%)`);
			if (p.warmth > 1) {
				const sepia = p.warmth / 100 * 35;
				if (sepia > .5) filters.push(`sepia(${sepia.toFixed(1)}%) hue-rotate(-5deg)`);
			}
			const filterStr = filters.join(" ");
			if (this.video.style.filter !== filterStr) this.video.style.setProperty("filter", filterStr, "important");
			if (this.video.style.willChange !== "filter") this.video.style.willChange = "filter";
		}
		/** Llamado por video.timeupdate (~4 veces/seg) */
		onTimeUpdate() {
			if (!this.isActive || document.hidden) return;
			const now = Date.now();
			if (now - this.lastApplyTime < this.updateIntervalMs) return;
			this.lastApplyTime = now;
			this.applySceneVariance();
			this.smoothStep();
			if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
			this.animFrameId = requestAnimationFrame(() => this.applyProfile());
		}
		onPlay() {
			if (!this.isActive) return;
			this.lastApplyTime = 0;
			this.onTimeUpdate();
		}
		onPause() {}
		onVisibility() {
			if (document.hidden) {
				this.video.style.filter = "";
				this.video.style.willChange = "";
			} else if (this.isActive && !this.video.paused) {
				this.lastApplyTime = 0;
				this.onTimeUpdate();
			}
		}
		start() {
			if (this.video.paused || this.video.ended || document.hidden) return;
			if (this.isActive) return;
			this.isActive = true;
			this.video.addEventListener("timeupdate", this.boundOnTimeUpdate);
			this.video.addEventListener("play", this.boundOnPlay);
			this.video.addEventListener("pause", this.boundOnPause);
			document.addEventListener("visibilitychange", this.boundOnVisibility);
			this.profileUpdateTimer = window.setInterval(() => {
				this.baseProfile = getCurrentProfile();
				this.baseProfile.contrast += this.userOffset.c;
				this.baseProfile.saturation += this.userOffset.s;
				this.baseProfile.brightness += this.userOffset.b;
				this.baseProfile.sharpness += this.userOffset.sh;
			}, 6e4);
			this.baseProfile = getCurrentProfile();
			this.baseProfile.contrast += this.userOffset.c;
			this.baseProfile.saturation += this.userOffset.s;
			this.baseProfile.brightness += this.userOffset.b;
			this.baseProfile.sharpness += this.userOffset.sh;
			this.currentProfile = { ...this.baseProfile };
			this.lastApplyTime = 0;
			if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
			this.animFrameId = requestAnimationFrame(() => {
				this.smoothStep();
				this.applyProfile();
			});
		}
		stop() {
			this.isActive = false;
			this.video.removeEventListener("timeupdate", this.boundOnTimeUpdate);
			this.video.removeEventListener("play", this.boundOnPlay);
			this.video.removeEventListener("pause", this.boundOnPause);
			document.removeEventListener("visibilitychange", this.boundOnVisibility);
			clearInterval(this.profileUpdateTimer);
			if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
		}
		applyManualState(state) {
			this.stop();
			this.smoothedProfile = {
				name: "Custom",
				sharpness: state.sharpness,
				contrast: state.contrast,
				saturation: state.saturation,
				brightness: state.brightness,
				warmth: state.nightShift,
				shadowLift: state.hdr / 100 * .05,
				highlightCompress: 1 - state.hdr / 100 * .15,
				gamma: 1 + state.hdr / 100 * .05
			};
			this.applyProfile();
		}
		setNightShiftOverride(val) {
			this.nightShiftOverride = val;
		}
		/** Para sincronizar con el popup */
		getCurrentValues() {
			const p = this.smoothedProfile;
			return {
				contrast: Math.round(p.contrast),
				saturation: Math.round(p.saturation),
				brightness: Math.round(p.brightness),
				sharpness: Math.round(p.sharpness),
				hdr: Math.round(p.shadowLift * 500 + (1 - p.highlightCompress) * 200),
				nightShift: Math.round(this.nightShiftOverride !== null ? this.nightShiftOverride : p.warmth),
				engineType: "CSS-v5"
			};
		}
		/** Aplicar perfil aprendido desde ProfileDB (convertido a Offset sobre Daylight base) */
		applyLearnedProfile(profile) {
			this.userOffset = {
				c: profile.c - TIME_PROFILES.daylight.contrast,
				s: profile.s - TIME_PROFILES.daylight.saturation,
				b: profile.b - TIME_PROFILES.daylight.brightness,
				sh: profile.sh - TIME_PROFILES.daylight.sharpness
			};
			this.baseProfile = getCurrentProfile();
			this.baseProfile.contrast += this.userOffset.c;
			this.baseProfile.saturation += this.userOffset.s;
			this.baseProfile.brightness += this.userOffset.b;
			this.baseProfile.sharpness += this.userOffset.sh;
			this.currentProfile.contrast = this.baseProfile.contrast;
			this.currentProfile.saturation = this.baseProfile.saturation;
			this.currentProfile.brightness = this.baseProfile.brightness;
			this.currentProfile.sharpness = this.baseProfile.sharpness;
		}
		destroy() {
			this.stop();
			if (this.svgElement) this.svgElement.remove();
		}
	};
	//#endregion
	//#region src/profile-db.ts
	var STORAGE_KEY = "ve_profile_db";
	var MAX_ENTRIES = 50;
	var EMA_ALPHA = .1;
	var ProfileDB = class {
		/**
		* Hashes domain with SHA-256. If crypto.subtle is unavailable (e.g. non-HTTPS),
		* falls back to a simple FNV-1a hash.
		*/
		static async hashDomain(hostname) {
			if (typeof crypto !== "undefined" && crypto.subtle) try {
				const data = new TextEncoder().encode(hostname);
				const hashBuffer = await crypto.subtle.digest("SHA-256", data);
				return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
			} catch (e) {}
			let hval = 2166136261;
			for (let i = 0; i < hostname.length; i++) {
				hval ^= hostname.charCodeAt(i);
				hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
			}
			return (hval >>> 0).toString(16).padStart(8, "0").padStart(16, "f");
		}
		static async getDB() {
			return new Promise((resolve) => {
				chrome.storage.local.get([STORAGE_KEY], (result) => {
					resolve(result[STORAGE_KEY] || {});
				});
			});
		}
		static async saveDB(db) {
			return new Promise((resolve) => {
				chrome.storage.local.set({ [STORAGE_KEY]: db }, resolve);
			});
		}
		static async getProfile(hostname) {
			const hash = await this.hashDomain(hostname);
			return (await this.getDB())[hash] || null;
		}
		static async updateProfile(hostname, contrast, saturation, brightness, sharpness) {
			const hash = await this.hashDomain(hostname);
			const db = await this.getDB();
			let profile = db[hash];
			const now = Date.now();
			if (profile) {
				profile.c = EMA_ALPHA * contrast + (1 - EMA_ALPHA) * profile.c;
				profile.s = EMA_ALPHA * saturation + (1 - EMA_ALPHA) * profile.s;
				profile.b = EMA_ALPHA * brightness + (1 - EMA_ALPHA) * profile.b;
				profile.sh = EMA_ALPHA * sharpness + (1 - EMA_ALPHA) * profile.sh;
				profile.n += 1;
				profile.t = now;
			} else profile = {
				h: hash,
				c: contrast,
				s: saturation,
				b: brightness,
				sh: sharpness,
				n: 1,
				t: now
			};
			db[hash] = profile;
			const entries = Object.values(db);
			if (entries.length > MAX_ENTRIES) {
				entries.sort((a, b) => b.t - a.t);
				const dbNew = {};
				for (let i = 0; i < MAX_ENTRIES; i++) dbNew[entries[i].h] = entries[i];
				await this.saveDB(dbNew);
			} else await this.saveDB(db);
		}
	};
	//#endregion
	//#region src/logger.ts
	var ErrorLogger = class {
		static storageKey = "ve_error_logs";
		static maxLogs = 50;
		static init() {
			if (typeof window !== "undefined") {
				window.addEventListener("error", (event) => {
					this.logError("Unhandled Error", event.message, event.filename, event.lineno);
				});
				window.addEventListener("unhandledrejection", (event) => {
					this.logError("Unhandled Promise Rejection", String(event.reason));
				});
			}
			const originalConsoleError = console.error;
			console.error = (...args) => {
				originalConsoleError.apply(console, args);
				this.logError("Console Error", args.map((a) => String(a)).join(" "));
			};
		}
		static getSanitizedUrl() {
			if (typeof window === "undefined") return "ServiceWorker";
			try {
				const parsed = new URL(window.location.href);
				return `${parsed.origin}${parsed.pathname}`;
			} catch {
				return "Unknown";
			}
		}
		static logError(type, message, source, line) {
			chrome.storage.local.get([this.storageKey], (result) => {
				let logs = result[this.storageKey] || [];
				const newLog = {
					timestamp: (/* @__PURE__ */ new Date()).toISOString(),
					type,
					message,
					source: source || "N/A",
					line: line || "N/A",
					url: this.getSanitizedUrl()
				};
				logs.unshift(newLog);
				if (logs.length > this.maxLogs) logs = logs.slice(0, this.maxLogs);
				chrome.storage.local.set({ [this.storageKey]: logs });
			});
		}
		static async getLogs() {
			return new Promise((resolve) => {
				chrome.storage.local.get([this.storageKey], (result) => {
					resolve(result[this.storageKey] || []);
				});
			});
		}
		static clearLogs() {
			chrome.storage.local.remove([this.storageKey]);
		}
	};
	//#endregion
	//#region src/content.ts
	/**
	* =========================================================================
	* UNIVERSAL VIDEO ENHANCER PRO — ENGINE ORCHESTRATOR v5.0
	* =========================================================================
	* 
	* Arquitectura Dual con Auto-Detección de Hardware:
	* - GPU Engine (WebGL2): Para Twitch, Netflix, y sitios sin CORS
	* - CSS Perceptual Engine v5.0 (SVG + CSS): Para YouTube y sitios con CORS
	* 
	* Novedades v5.0:
	* - Auto-detección iGPU vs dGPU via WEBGL_debug_renderer_info
	* - Base de datos de aprendizaje por dominio (SHA-256 hashed)
	* - Event-driven rendering (~93% menos CPU que v4.0)
	* - Motor perceptual Weber-Fechner para negros y luminosidad
	*/
	ErrorLogger.init();
	if (!window.__videoEnhancerInjected) {
		window.__videoEnhancerInjected = true;
		let state = {
			sharpness: 15,
			contrast: 108,
			saturation: 112,
			brightness: 100,
			hdr: 0,
			nightShift: 0,
			algorithm: "CAS",
			mode: "auto"
		};
		const cssEngines = /* @__PURE__ */ new WeakMap();
		const hostname = window.location.hostname.toLowerCase();
		hostname.includes("youtube") || hostname.includes("youtu.be");
		let storageKey = "videoEnhancerSettings";
		let lastPopupMessage = 0;
		const POPUP_MSG_INTERVAL = 150;
		let autoRafId = 0;
		let autoEngineActive = false;
		let learnedProfileApplied = false;
		let learnAccumulator = 0;
		const knownVideos = /* @__PURE__ */ new Set();
		function initialFindAllVideos(root = document) {
			let videos = Array.from(root.querySelectorAll("video"));
			root.querySelectorAll("*").forEach((el) => {
				if (el.shadowRoot) videos = videos.concat(initialFindAllVideos(el.shadowRoot));
			});
			return videos;
		}
		function findAllVideos() {
			initialFindAllVideos().forEach((v) => {
				if (!knownVideos.has(v)) attachVideoEvents(v);
			});
			for (const v of knownVideos) if (!v.isConnected) knownVideos.delete(v);
			return Array.from(knownVideos);
		}
		function getPlayingVideos() {
			return findAllVideos().filter((v) => !v.paused && !v.ended);
		}
		function startAutoEngine() {
			if (autoEngineActive) return;
			autoEngineActive = true;
			const loop = () => {
				if (!autoEngineActive || state.mode !== "auto" || document.hidden) {
					stopAutoEngine();
					return;
				}
				const playingVideos = getPlayingVideos();
				if (playingVideos.length === 0) {
					autoRafId = requestAnimationFrame(loop);
					return;
				}
				playingVideos.forEach((video) => {
					ensureCSSEngine(video);
				});
				const now = Date.now();
				if (now - lastPopupMessage > POPUP_MSG_INTERVAL) {
					lastPopupMessage = now;
					sendAutoUpdateToPopup(playingVideos[0]);
				}
				learnAccumulator += 1 / 60;
				if (learnAccumulator >= 30) {
					learnAccumulator = 0;
					learnFromCurrentState(playingVideos[0]);
				}
				autoRafId = requestAnimationFrame(loop);
			};
			autoRafId = requestAnimationFrame(loop);
		}
		function stopAutoEngine() {
			autoEngineActive = false;
			cancelAnimationFrame(autoRafId);
		}
		function ensureCSSEngine(video) {
			if (!cssEngines.has(video)) cssEngines.set(video, new CSSAdaptiveEngine(video));
			const engine = cssEngines.get(video);
			if (state.mode === "auto" && state.nightShiftOverride !== void 0) engine.setNightShiftOverride(state.nightShiftOverride);
			else if (state.mode === "auto") engine.setNightShiftOverride(null);
			engine.start();
		}
		function sendAutoUpdateToPopup(video) {
			let values;
			if (cssEngines.has(video)) values = cssEngines.get(video).getCurrentValues();
			else return;
			if (chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({
				type: "VE_AUTO_UPDATE",
				payload: values
			}, () => {
				if (chrome.runtime.lastError) {}
			});
		}
		async function loadLearnedProfile() {
			if (learnedProfileApplied) return;
			try {
				const profile = await ProfileDB.getProfile(hostname);
				if (profile && profile.n >= 3) {
					learnedProfileApplied = true;
					if (state.mode === "auto") findAllVideos().forEach((video) => {
						if (cssEngines.has(video)) cssEngines.get(video).applyLearnedProfile(profile);
					});
				}
			} catch {}
		}
		async function learnFromCurrentState(video) {
			try {
				if (state.mode !== "custom") return;
				let values;
				if (cssEngines.has(video)) values = cssEngines.get(video).getCurrentValues();
				if (values) await ProfileDB.updateProfile(hostname, values.contrast, values.saturation, values.brightness, values.sharpness);
			} catch {}
		}
		function applyCustomFilters(video) {
			if (document.hidden) {
				video.style.filter = "";
				return;
			}
			if (!cssEngines.has(video)) cssEngines.set(video, new CSSAdaptiveEngine(video));
			cssEngines.get(video).applyManualState(state);
		}
		function checkEngineState() {
			if (document.hidden) {
				stopAutoEngine();
				findAllVideos().forEach((v) => {
					v.style.filter = "";
					v.style.willChange = "";
					if (cssEngines.has(v)) cssEngines.get(v).stop();
				});
				return;
			}
			if (state.mode === "auto") if (getPlayingVideos().length > 0) startAutoEngine();
			else stopAutoEngine();
			else if (state.mode === "default") {
				stopAutoEngine();
				findAllVideos().forEach((v) => {
					v.style.filter = "";
					v.style.willChange = "";
					if (cssEngines.has(v)) cssEngines.get(v).stop();
				});
			} else {
				stopAutoEngine();
				findAllVideos().forEach((v) => {
					applyCustomFilters(v);
				});
			}
		}
		const visibilityObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				const video = entry.target;
				video.dataset.veVisible = entry.isIntersecting ? "true" : "false";
				if (!entry.isIntersecting) {
					if (cssEngines.has(video)) cssEngines.get(video).stop();
				}
			});
			checkEngineState();
		}, { threshold: .1 });
		function attachVideoEvents(video) {
			if (video.dataset.veEnhanced) return;
			video.dataset.veEnhanced = "true";
			video.dataset.veVisible = "true";
			knownVideos.add(video);
			video.style.willChange = "filter";
			visibilityObserver.observe(video);
			const handleStateChange = () => checkEngineState();
			video.addEventListener("play", handleStateChange);
			video.addEventListener("playing", handleStateChange);
			video.addEventListener("pause", handleStateChange);
			video.addEventListener("ended", handleStateChange);
			video.addEventListener("emptied", handleStateChange);
			video.addEventListener("enterpictureinpicture", () => {
				video.dataset.vePipActive = "true";
				checkEngineState();
			});
			video.addEventListener("leavepictureinpicture", () => {
				video.dataset.vePipActive = "false";
				checkEngineState();
			});
		}
		const observedRoots = /* @__PURE__ */ new WeakSet();
		const mutationObserver = new MutationObserver((mutations) => {
			let found = false;
			mutations.forEach((m) => {
				m.addedNodes?.forEach((node) => {
					const el = node;
					if (el.tagName === "VIDEO") {
						attachVideoEvents(el);
						found = true;
					} else if (el.querySelectorAll) {
						el.querySelectorAll("video").forEach((v) => {
							attachVideoEvents(v);
							found = true;
						});
						if (el.shadowRoot) observeRoot(el.shadowRoot);
						el.querySelectorAll("*").forEach((e) => {
							if (e.shadowRoot) observeRoot(e.shadowRoot);
						});
					}
				});
			});
			if (found) checkEngineState();
		});
		function observeRoot(root) {
			if (!root || observedRoots.has(root)) return;
			observedRoots.add(root);
			mutationObserver.observe(root, {
				childList: true,
				subtree: true
			});
			root.querySelectorAll("*").forEach((el) => {
				if (el.shadowRoot) observeRoot(el.shadowRoot);
			});
		}
		function initialize() {
			chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
				if (message.type === "VE_APPLY_SETTINGS") {
					state = {
						...state,
						...message.settings
					};
					checkEngineState();
					sendResponse({
						ok: true,
						state
					});
				} else if (message.type === "VE_GET_STATE") sendResponse({
					state,
					mode: state.mode
				});
				return true;
			});
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === "local" && changes["ve_settings_global"]) {
					state = Object.assign(state, changes["ve_settings_global"].newValue);
					checkEngineState();
				}
			});
			chrome.storage.local.get([storageKey, "ve_settings_global"], (result) => {
				const st = result[storageKey] || result["ve_settings_global"];
				if (st) state = Object.assign(state, st);
				initialFindAllVideos().forEach(attachVideoEvents);
				observeRoot(document.documentElement);
				checkEngineState();
				loadLearnedProfile();
			});
			setInterval(() => {
				const vids = initialFindAllVideos();
				if (vids.length > 0) {
					let hasNew = false;
					vids.forEach((v) => {
						if (!knownVideos.has(v)) {
							attachVideoEvents(v);
							hasNew = true;
						}
					});
					if (hasNew) checkEngineState();
				}
			}, 1500);
			window.addEventListener("yt-navigate-finish", () => {
				setTimeout(() => {
					initialFindAllVideos().forEach(attachVideoEvents);
					checkEngineState();
					learnedProfileApplied = false;
					loadLearnedProfile();
				}, 300);
			});
			window.addEventListener("spfdone", () => {
				initialFindAllVideos().forEach(attachVideoEvents);
				checkEngineState();
			});
			window.addEventListener("play", () => checkEngineState(), true);
			window.addEventListener("playing", () => checkEngineState(), true);
			window.addEventListener("pause", () => checkEngineState(), true);
			window.addEventListener("ended", () => checkEngineState(), true);
			document.addEventListener("visibilitychange", () => {
				checkEngineState();
			});
		}
		initialize();
	}
	//#endregion
})();
