import './style.css';
import { Header } from './components/Header.js';
import { ScriptStudio } from './components/ScriptStudio.js';

const app = document.querySelector('#app');
let contentArea;

// Router
function navigate(page) {
  if (!contentArea) return;
  contentArea.innerHTML = '';

  if (page === 'script') {
    contentArea.appendChild(ScriptStudio());
  } else if (page === 'characters') {
    import('./components/CharacterStudio.js').then(({ CharacterStudio }) => {
      contentArea.appendChild(CharacterStudio());
    });
  } else if (page === 'scenes') {
    import('./components/SceneStudio.js').then(({ SceneStudio }) => {
      contentArea.appendChild(SceneStudio());
    });
  } else if (page === 'director') {
    import('./components/DirectorStudio.js').then(({ DirectorStudio }) => {
      contentArea.appendChild(DirectorStudio());
    });
  } else if (page === 'sclass') {
    import('./components/SClassStudio.js').then(({ SClassStudio }) => {
      contentArea.appendChild(SClassStudio());
    });
  }
}

app.innerHTML = '';
// Pass navigate to Header so links work
app.appendChild(Header(navigate));

contentArea = document.createElement('main');
contentArea.id = 'content-area';
contentArea.className = 'flex-1 relative w-full overflow-hidden flex flex-col bg-app-bg';
app.appendChild(contentArea);

// Initial Route - Script Studio
navigate('script');

// Event Listener for Navigation
window.addEventListener('navigate', (e) => {
  if (e.detail.page === 'settings') {
    import('./components/SettingsModal.js').then(({ SettingsModal }) => {
      document.body.appendChild(SettingsModal());
    });
  } else {
    navigate(e.detail.page);
  }
});
