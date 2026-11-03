export class NotificationManager {
    constructor() {
        this.toast = document.getElementById('toast');
        this.timer = null;
    }

    show(message, type = 'info', duration = 3500) {
        if (!this.toast) {
            console.log(`[${type}] ${message}`);
            return;
        }

        this.toast.textContent = message;
        this.toast.className = 'toast show';
        
        if (type === 'error') {
            this.toast.style.background = 'var(--danger)';
        } else if (type === 'success') {
            this.toast.style.background = 'var(--success)';
        } else {
            this.toast.style.background = 'var(--text-primary)';
        }

        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.toast.classList.remove('show');
        }, duration);
    }

    success(message) {
        this.show(message, 'success');
    }

    error(message) {
        this.show(message, 'error');
    }

    info(message) {
        this.show(message, 'info');
    }
}

export const notifications = new NotificationManager();
