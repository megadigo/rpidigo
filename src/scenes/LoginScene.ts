/**
 * LoginScene — two-panel login / register flow.
 * Login panel: name + password.
 * Register panel: name + password + email + champion selection.
 */
import Phaser from 'phaser'
import { login, register } from '../player/Auth.ts'

const CHAMPIONS = ['arthax', 'borg', 'gangblanc', 'grum', 'kanji', 'katan', 'okomo', 'zhinja'] as const

export class LoginScene extends Phaser.Scene {
  private overlay!: HTMLDivElement
  private selectedChampion: (typeof CHAMPIONS)[number] = CHAMPIONS[0]

  constructor() {
    super({ key: 'LoginScene' })
  }

  create(): void {
    this.overlay = document.createElement('div')
    this.overlay.id = 'login-overlay'
    this.overlay.style.cssText = [
      'position:fixed', 'inset:0', 'display:flex',
      'align-items:center', 'justify-content:center',
      'background:#000', 'z-index:100',
    ].join(';')

    const championOptions = CHAMPIONS.map(
      c => `<button class="champion-btn${c === this.selectedChampion ? ' selected' : ''}" data-id="${c}">
        <canvas class="champion-avatar" width="32" height="32" data-src="/assets/sprites/Players/player_${c}.png"></canvas>
        <span>${c}</span>
      </button>`,
    ).join('')

    this.overlay.innerHTML = `
      <div class="login-box">
        <!-- LOGIN PANEL -->
        <div id="panel-login">
          <h2>Enter the World</h2>
          <p id="login-error" class="error" style="display:none"></p>
          <label>Name<input id="login-name" type="text" placeholder="Your name" maxlength="24"></label>
          <label>Password<input id="login-pass" type="password" placeholder="Password"></label>
          <div class="login-buttons">
            <button id="btn-login">Login</button>
            <button id="btn-go-register" class="secondary">Register</button>
          </div>
        </div>

        <!-- REGISTER PANEL -->
        <div id="panel-register" style="display:none">
          <h2>Create Account</h2>
          <p id="reg-error" class="error" style="display:none"></p>
          <label>Name<input id="reg-name" type="text" placeholder="Your name" maxlength="24"></label>
          <label>Password<input id="reg-pass" type="password" placeholder="Password"></label>
          <label>Email<input id="reg-email" type="email" placeholder="email@example.com"></label>
          <div class="champion-grid">${championOptions}</div>
          <div class="login-buttons">
            <button id="btn-register">Register</button>
            <button id="btn-go-login" class="secondary">Back to Login</button>
          </div>
        </div>
      </div>
    `

    const style = document.createElement('style')
    style.id = 'login-style'
    style.textContent = `
      .login-box { font-family:monospace; color:#fff; width:340px; }
      .login-box h2 { text-align:center; margin-bottom:1rem; letter-spacing:.2em; }
      .login-box label { display:block; margin:.5rem 0; font-size:.75rem; text-transform:uppercase; color:#aaa; }
      .login-box input { display:block; width:100%; padding:.4rem .6rem; margin-top:.2rem;
        background:#111; border:1px solid #444; color:#fff; font-family:monospace; font-size:1rem; box-sizing:border-box; }
      .champion-grid { display:flex; flex-wrap:wrap; gap:.4rem; margin:.8rem 0; justify-content:center; }
      .champion-btn { background:#111; border:2px solid #333; color:#aaa; cursor:pointer;
        padding:.3rem; font-family:monospace; font-size:.65rem; text-align:center;
        width:72px; display:flex; flex-direction:column; align-items:center; gap:.2rem; }
      .champion-avatar { width:32px; height:32px; image-rendering:pixelated; }
      .champion-btn.selected { border-color:#fff; color:#fff; }
      .login-buttons { display:flex; gap:.6rem; margin-top:.8rem; }
      .login-buttons button { flex:1; padding:.5rem; background:transparent; border:1px solid #fff;
        color:#fff; font-family:monospace; font-size:.9rem; cursor:pointer; text-transform:uppercase; letter-spacing:.1em; }
      .login-buttons button:hover { background:#fff; color:#000; }
      .login-buttons button.secondary { border-color:#555; color:#888; }
      .login-buttons button.secondary:hover { background:#555; color:#fff; }
      .error { color:#f66; font-size:.8rem; text-align:center; margin-bottom:.5rem; }
    `
    document.head.appendChild(style)
    document.body.appendChild(this.overlay)

    // Render frame 0 of each champion (top-left 16×16, scaled to 32×32)
    this.overlay.querySelectorAll<HTMLCanvasElement>('canvas.champion-avatar').forEach(canvas => {
      const ctx = canvas.getContext('2d')!
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, 16, 16, 0, 0, 32, 32)
      img.src = canvas.dataset.src!
    })

    // Champion selection
    this.overlay.querySelectorAll<HTMLButtonElement>('.champion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedChampion = btn.dataset.id as (typeof CHAMPIONS)[number]
        this.overlay.querySelectorAll('.champion-btn').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
      })
    })

    // Panel switching
    document.getElementById('btn-go-register')!.addEventListener('click', () => this._showPanel('register'))
    document.getElementById('btn-go-login')!.addEventListener('click', () => this._showPanel('login'))

    // Submit actions
    document.getElementById('btn-login')!.addEventListener('click', () => void this._submitLogin())
    document.getElementById('btn-register')!.addEventListener('click', () => void this._submitRegister())
  }

  private _showPanel(panel: 'login' | 'register'): void {
    const loginPanel = document.getElementById('panel-login')!
    const regPanel   = document.getElementById('panel-register')!
    if (panel === 'register') {
      loginPanel.style.display = 'none'
      regPanel.style.display = ''
      // Pre-fill name if already typed
      const loginName = (document.getElementById('login-name') as HTMLInputElement).value.trim()
      if (loginName) (document.getElementById('reg-name') as HTMLInputElement).value = loginName
    } else {
      regPanel.style.display = 'none'
      loginPanel.style.display = ''
    }
  }

  private async _submitLogin(): Promise<void> {
    const name = (document.getElementById('login-name') as HTMLInputElement).value.trim()
    const pass = (document.getElementById('login-pass') as HTMLInputElement).value
    const errEl = document.getElementById('login-error')!
    errEl.style.display = 'none'
    if (!name || !pass) { errEl.textContent = 'Name and password are required.'; errEl.style.display = 'block'; return }
    try {
      await login(name, pass)
      this._cleanup()
      this.scene.start('LoadingScene')
    } catch (err: unknown) {
      errEl.textContent = err instanceof Error ? err.message : String(err)
      errEl.style.display = 'block'
    }
  }

  private async _submitRegister(): Promise<void> {
    const name  = (document.getElementById('reg-name') as HTMLInputElement).value.trim()
    const pass  = (document.getElementById('reg-pass') as HTMLInputElement).value
    const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim()
    const errEl = document.getElementById('reg-error')!
    errEl.style.display = 'none'
    if (!name || !pass) { errEl.textContent = 'Name and password are required.'; errEl.style.display = 'block'; return }
    try {
      await register(name, email, pass, this.selectedChampion)
      this._cleanup()
      this.scene.start('LoadingScene')
    } catch (err: unknown) {
      errEl.textContent = err instanceof Error ? err.message : String(err)
      errEl.style.display = 'block'
    }
  }

  private _cleanup(): void {
    this.overlay.remove()
    document.getElementById('login-style')?.remove()
  }
}
