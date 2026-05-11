/**
 * LoginScene — registration / login with name, email, password, and champion selection.
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
        <img src="/assets/sprites/entities/players/player_${c}.png" alt="${c}" width="32" height="32">
        <span>${c}</span>
      </button>`,
    ).join('')

    this.overlay.innerHTML = `
      <div class="login-box">
        <h2>Enter the World</h2>
        <p id="login-error" class="error" style="display:none"></p>

        <label>Name<input id="login-name" type="text" placeholder="Your name" maxlength="24"></label>
        <label>Email<input id="login-email" type="email" placeholder="email@example.com"></label>
        <label>Password<input id="login-pass" type="password" placeholder="Password"></label>

        <div class="champion-grid">${championOptions}</div>

        <div class="login-buttons">
          <button id="btn-login">Login</button>
          <button id="btn-register">Register</button>
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
        background:#111; border:1px solid #444; color:#fff; font-family:monospace; font-size:1rem; }
      .champion-grid { display:flex; flex-wrap:wrap; gap:.4rem; margin:.8rem 0; justify-content:center; }
      .champion-btn { background:#111; border:2px solid #333; color:#aaa; cursor:pointer;
        padding:.3rem; font-family:monospace; font-size:.65rem; text-align:center;
        width:72px; display:flex; flex-direction:column; align-items:center; gap:.2rem; }
      .champion-btn img { image-rendering:pixelated; }
      .champion-btn.selected { border-color:#fff; color:#fff; }
      .login-buttons { display:flex; gap:.6rem; margin-top:.8rem; }
      .login-buttons button { flex:1; padding:.5rem; background:transparent; border:1px solid #fff;
        color:#fff; font-family:monospace; font-size:.9rem; cursor:pointer; text-transform:uppercase; letter-spacing:.1em; }
      .login-buttons button:hover { background:#fff; color:#000; }
      .error { color:#f66; font-size:.8rem; text-align:center; margin-bottom:.5rem; }
    `
    document.head.appendChild(style)
    document.body.appendChild(this.overlay)

    // Champion selection
    this.overlay.querySelectorAll<HTMLButtonElement>('.champion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedChampion = btn.dataset.id as (typeof CHAMPIONS)[number]
        this.overlay.querySelectorAll('.champion-btn').forEach(b => b.classList.remove('selected'))
        btn.classList.add('selected')
      })
    })

    document.getElementById('btn-login')!.addEventListener('click', () => void this._submit('login'))
    document.getElementById('btn-register')!.addEventListener('click', () => void this._submit('register'))
  }

  private async _submit(mode: 'login' | 'register'): Promise<void> {
    const name  = (document.getElementById('login-name') as HTMLInputElement).value.trim()
    const email = (document.getElementById('login-email') as HTMLInputElement).value.trim()
    const pass  = (document.getElementById('login-pass') as HTMLInputElement).value
    const errEl = document.getElementById('login-error')!

    errEl.style.display = 'none'

    if (!name || !pass) { this._showError('Name and password are required.'); return }

    try {
      if (mode === 'register') {
        await register(name, email, pass, this.selectedChampion)
      } else {
        await login(name, pass)
      }
      this._cleanup()
      this.scene.start('LoadingScene')
    } catch (err: unknown) {
      this._showError(err instanceof Error ? err.message : String(err))
    }
  }

  private _showError(msg: string): void {
    const el = document.getElementById('login-error')!
    el.textContent = msg
    el.style.display = 'block'
  }

  private _cleanup(): void {
    this.overlay.remove()
    document.getElementById('login-style')?.remove()
  }
}
