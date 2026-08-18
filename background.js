//#region \0rolldown/runtime.js
var __esmMin = (fn, res, err) => () => {
	if (err) throw err[0];
	try {
		return fn && (res = fn(fn = 0)), res;
	} catch (e) {
		throw err = [e], e;
	}
};
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
//#endregion
//#region src/logger.ts
var ErrorLogger;
var init_logger = __esmMin((() => {
	ErrorLogger = class {
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
}));
//#endregion
//#region src/background.ts
var require_background = /* @__PURE__ */ __commonJSMin((() => {
	init_logger();
	ErrorLogger.init();
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.type === "GET_TAB_ID") sendResponse({ tabId: sender.tab?.id });
		return true;
	});
	chrome.tabs.onRemoved.addListener((tabId) => {
		const key = `ve_settings_${tabId}`;
		chrome.storage.local.remove(key, () => {
			if (chrome.runtime.lastError) console.warn(`[Background] Error al limpiar almacenamiento para pestaña ${tabId}:`, chrome.runtime.lastError);
			else console.log(`[Background] Almacenamiento limpio para la pestaña cerrada: ${tabId}`);
		});
	});
	chrome.runtime.onInstalled.addListener((details) => {
		if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.storage.local.get(["ve_setup_complete"], (result) => {
			if (!result.ve_setup_complete) chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
		});
	});
}));
//#endregion
export default require_background();
