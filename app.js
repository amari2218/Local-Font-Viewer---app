/**
 * Local Font Viewer Core Logic
 * Strategy: Heuristic + Strict Pixel Check ONLY (Production Ready)
 */

const appState = {
    fonts: [],
    searchTerm: '',
    previewText: 'Hello World! あいうえお',
    isJapaneseOnly: false,
    selectedFont: null
};

const elements = {
    fontGrid: document.getElementById('fontGrid'),
    searchInput: document.getElementById('searchInput'),
    previewInput: document.getElementById('previewInput'),
    japaneseOnlyToggle: document.getElementById('japaneseOnlyToggle'),
    modal: document.getElementById('detailsModal'),
    modalFontName: document.getElementById('modalFontName'),
    modalSampleText: document.getElementById('modalSampleText'),
    closeModal: document.getElementById('closeModal'),
    copyNameBtn: document.getElementById('copyNameBtn'),
    useAsAppFontBtn: document.getElementById('useAsAppFontBtn'),
    loadBtn: document.getElementById('loadFontsBtn')
};

async function init() {
    console.log("Initializing Font Viewer...");
    setupEventListeners();

    const savedFont = localStorage.getItem('customAppFont');
    if (savedFont) {
        document.documentElement.style.setProperty('--app-font', savedFont);
    }

    if (!('queryLocalFonts' in window)) {
        if (elements.fontGrid) elements.fontGrid.innerHTML = `
            <div class="error-state">
                申し訳ない！ このブラウザは対応してないみたいだ。<br>
                Chrome か Edge の最新版で試してくれ！
            </div>`;
        if (elements.loadBtn) elements.loadBtn.style.display = 'none';
        return;
    }
}

async function loadFonts() {
    try {
        const localFonts = await window.queryLocalFonts();
        console.log(`Loaded ${localFonts.length} fonts.`);

        const uniqueFamilies = new Set();
        appState.fonts = [];

        // Synchronous Heuristic Check
        // Expanded Keywords to catch as many as possible instantly
        const keywords = [
            "mincho", "gothic", "myrn", "明朝", "ゴシック",
            "jp", "jis", "meiryo", "yu ", "hgs", "hiragino", "osaka",
            "ud", "maru", "kyokasho", "kaku", "pop",
            "yomogi", "rocknroll", "balsamiq", "reggae", "stick", "dot", "hana", "anito", "biz",
            "shuei", "bunyu", "kinuta", "toppan"
        ];

        for (const font of localFonts) {
            if (!uniqueFamilies.has(font.family)) {
                uniqueFamilies.add(font.family);

                const lower = font.family.toLowerCase();
                const isHeuristic = keywords.some(k => lower.includes(k));

                appState.fonts.push({
                    family: font.family,
                    fullName: font.fullName,
                    isJapaneseSupported: isHeuristic ? true : null
                });
            }
        }

        renderFonts();
        detectJapaneseSupportAsync();

    } catch (err) {
        console.error("Font load error:", err);
        if (elements.fontGrid) elements.fontGrid.innerHTML = `<div class="error-state">読み込み失敗！リロードしてみてくれ。</div>`;
    }
}

/**
 * Background Scanner (Pixel Check Only)
 * Scans remaining 'null' fonts to see if they support Japanese.
 */
async function detectJapaneseSupportAsync() {
    console.log("Starting Background Scan...");

    // Minimal Status UI
    let statusEl = document.getElementById('detectionStatus');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'detectionStatus';
        statusEl.style.cssText = "position:fixed; bottom:10px; right:10px; background:rgba(0,0,0,0.8); color:#fff; padding:8px 12px; border-radius:4px; font-size:12px; z-index:9999;";
        document.body.appendChild(statusEl);
    }
    statusEl.innerText = "Analyzing fonts...";

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = 30;
    canvas.height = 30;
    const testChar = "あ";

    let foundCount = 0;
    const CHUNK_SIZE = 50;

    const processChunk = async (startIndex) => {
        const end = Math.min(startIndex + CHUNK_SIZE, appState.fonts.length);

        let suspects = [];
        for (let i = startIndex; i < end; i++) {
            if (appState.fonts[i].isJapaneseSupported === null) suspects.push(i);
        }

        // Batch Load
        if (suspects.length > 0) {
            try {
                await Promise.all(suspects.map(i => document.fonts.load(`30px "${appState.fonts[i].family}"`)));
            } catch (e) { }
        }

        for (let idx of suspects) {
            const font = appState.fonts[idx];

            // PIXEL CHECK (Sans vs Serif)
            // If font supports JP:  Target+Sans == Target+Serif (Identical)
            // If font crashes to fallback: SystemSans (Gothic) != SystemSerif (Mincho) (Different)
            try {
                // 1. Draw with Sans fallback
                ctx.clearRect(0, 0, 30, 30);
                const safe = font.family.replace(/"/g, '\\"');

                ctx.font = `20px "${safe}", sans-serif`;
                ctx.textBaseline = 'top';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#000000';
                ctx.fillText(testChar, 15, 5);
                const d1 = ctx.getImageData(0, 0, 30, 30).data;

                // 2. Draw with Serif fallback
                ctx.clearRect(0, 0, 30, 30);
                ctx.font = `20px "${safe}", serif`;
                ctx.fillText(testChar, 15, 5);
                const d2 = ctx.getImageData(0, 0, 30, 30).data;

                let diff = 0;
                // Check Alpha channel
                for (let p = 0; p < d1.length; p += 4) {
                    if (Math.abs(d1[p + 3] - d2[p + 3]) > 50) diff++;
                }

                // Low Diff = Consistent Look = Supported
                // High Diff = Fallback Revealed = Not Supported
                if (diff < 20) {
                    font.isJapaneseSupported = true;
                    foundCount++;
                } else {
                    font.isJapaneseSupported = false;
                }
            } catch (e) {
                font.isJapaneseSupported = false;
            }
        }

        // Update UI
        // Only show percentage to keep it clean
        const percent = Math.round((end / appState.fonts.length) * 100);
        statusEl.innerText = `Analyzing... ${percent}%`;

        // Live update if filter is active
        if (appState.isJapaneseOnly && suspects.length > 0 && foundCount > 0) {
            renderFonts();
        }

        if (end < appState.fonts.length) {
            setTimeout(() => processChunk(end), 10);
        } else {
            statusEl.innerText = `Done! Checked all fonts.`;
            setTimeout(() => statusEl.remove(), 3000);
            renderFonts(); // Final ensure
        }
    };
    processChunk(0);
}

function renderFonts() {
    elements.fontGrid.innerHTML = '';

    const filtered = appState.fonts.filter(font => {
        const matchesSearch = font.family.toLowerCase().includes(appState.searchTerm.toLowerCase());

        if (!appState.isJapaneseOnly) return matchesSearch;
        return matchesSearch && font.isJapaneseSupported === true;
    });

    if (filtered.length === 0) {
        elements.fontGrid.innerHTML = '<div class="loading-state">見つからないな... 条件を変えてみてくれ！</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    // Render limit for performance
    filtered.slice(0, 100).forEach(font => {
        const card = document.createElement('div');
        card.className = 'font-card';
        card.style.fontFamily = `"${font.family}"`;

        card.innerHTML = `
            <div class="font-name" style="font-family: var(--app-font)">${font.family}</div>
            <div class="font-preview">${appState.previewText}</div>
        `;
        card.addEventListener('click', () => openModal(font));
        fragment.appendChild(card);
    });
    elements.fontGrid.appendChild(fragment);
}

function setupEventListeners() {
    elements.directionalKeyNavigation = (e) => {
        // Optional: Add keyboard navigation logic here later if requested
    };

    elements.japaneseOnlyToggle.addEventListener('change', (e) => {
        appState.isJapaneseOnly = e.target.checked;
        renderFonts();
    });

    if (elements.loadBtn) {
        elements.loadBtn.addEventListener('click', async () => {
            elements.loadBtn.textContent = "Loading...";
            elements.loadBtn.disabled = true;
            await loadFonts();
        });
    }

    elements.searchInput.addEventListener('input', (e) => {
        appState.searchTerm = e.target.value;
        renderFonts();
    });
    elements.previewInput.addEventListener('input', (e) => {
        appState.previewText = e.target.value || 'Hello World! あいうえお';
        renderFonts();
    });

    elements.closeModal.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => { if (e.target === elements.modal) closeModal(); });

    elements.copyNameBtn.addEventListener('click', () => {
        if (appState.selectedFont) {
            navigator.clipboard.writeText(appState.selectedFont.family);
            elements.copyNameBtn.textContent = "Copied!";
            setTimeout(() => elements.copyNameBtn.textContent = "Copy Name", 1500);
        }
    });

    elements.useAsAppFontBtn.addEventListener('click', () => {
        if (appState.selectedFont) {
            const fontSetting = `"${appState.selectedFont.family}", sans-serif`;
            document.documentElement.style.setProperty('--app-font', fontSetting);
            localStorage.setItem('customAppFont', fontSetting);
            elements.useAsAppFontBtn.textContent = "Applied!";
            setTimeout(() => elements.useAsAppFontBtn.textContent = "Use for App UI", 1500);
        }
    });
}

function openModal(font) {
    appState.selectedFont = font;
    elements.modalFontName.textContent = font.family;
    elements.modalFontName.style.fontFamily = `"${font.family}"`;
    elements.modalSampleText.style.fontFamily = `"${font.family}"`;
    elements.modal.classList.add('visible');
    elements.modal.classList.remove('hidden');
}

function closeModal() {
    elements.modal.classList.remove('visible');
    setTimeout(() => elements.modal.classList.add('hidden'), 300);
}

init();
