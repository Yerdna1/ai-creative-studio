export function ScriptStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-y-auto';

    const hero = document.createElement('div');
    hero.className = 'flex flex-col items-center mb-10';
    hero.innerHTML = `
        <div class="mb-10 relative">
            <div class="w-24 h-24 bg-primary/10 rounded-3xl flex items-center justify-center border border-primary/20">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                </svg>
            </div>
        </div>
        <h1 class="text-4xl md:text-7xl font-black text-white tracking-widest uppercase mb-4">Script Studio</h1>
        <p class="text-secondary text-sm font-medium opacity-60">Import scripts and generate shots with AI</p>
    `;

    const uploadSection = document.createElement('div');
    uploadSection.className = 'w-full max-w-4xl bg-[#111]/90 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8';

    uploadSection.innerHTML = `
        <div class="space-y-6">
            <div>
                <label class="text-[10px] font-bold text-muted uppercase tracking-widest ml-1 mb-2 block">Import Script</label>
                <textarea
                    id="script-input"
                    placeholder="Paste your script here... Episodes will be automatically detected and parsed."
                    class="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-5 text-white placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors min-h-[200px] resize-y font-mono text-sm"
                ></textarea>
            </div>

            <div class="flex gap-4">
                <button id="parse-btn" class="flex-1 bg-primary text-black font-black py-4 rounded-2xl hover:shadow-glow hover:scale-[1.02] active:scale-[0.98] transition-all">
                    Parse Script
                </button>
                <button id="generate-btn" class="flex-1 bg-white/10 text-white font-black py-4 rounded-2xl hover:bg-white/20 transition-all">
                    Generate Shots
                </button>
            </div>

            <div id="episodes-list" class="mt-8 space-y-3">
                <p class="text-secondary text-sm text-center">No episodes loaded yet</p>
            </div>
        </div>
    `;

    container.appendChild(hero);
    container.appendChild(uploadSection);

    // Add event listeners
    setTimeout(() => {
        const parseBtn = container.querySelector('#parse-btn');
        const generateBtn = container.querySelector('#generate-btn');
        const scriptInput = container.querySelector('#script-input');
        const episodesList = container.querySelector('#episodes-list');

        parseBtn.onclick = () => {
            const text = scriptInput.value.trim();
            if (!text) return;

            // Simple episode parser
            const episodes = text.split(/\n\n+/).filter(block => block.length > 50);
            episodesList.innerHTML = episodes.map((ep, i) => `
                <div class="bg-black/40 border border-white/5 rounded-xl p-4">
                    <h3 class="text-white font-bold mb-2">Episode ${i + 1}</h3>
                    <p class="text-secondary text-sm line-clamp-3">${ep.substring(0, 200)}...</p>
                    <p class="text-primary text-xs mt-2">${Math.ceil(ep.split(/\s+/).length / 150)} scenes estimated</p>
                </div>
            `).join('');

            parseBtn.textContent = `Parsed ${episodes.length} Episodes`;
            parseBtn.disabled = true;
            parseBtn.classList.add('opacity-50');
        };

        generateBtn.onclick = () => {
            generateBtn.innerHTML = `
                <svg class="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            `;
            setTimeout(() => {
                generateBtn.textContent = 'Shots Generated!';
                generateBtn.classList.add('bg-primary', 'text-black');
                generateBtn.classList.remove('bg-white/10');
            }, 2000);
        };
    }, 100);

    return container;
}
