export class Sidebar {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.mobileMenuBtn = document.getElementById('mobileMenu');
        this.init();
    }

    init() {
        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener('click', () => {
                this.toggleMobileMenu();
            });
        }

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (this.sidebar && this.mobileMenuBtn) {
                    if (!this.sidebar.contains(e.target) && !this.mobileMenuBtn.contains(e.target)) {
                        this.sidebar.classList.remove('open');
                        this.mobileMenuBtn.setAttribute('aria-expanded', 'false');
                    }
                }
            }
        });
    }

    toggleMobileMenu() {
        if (!this.sidebar) return;
        
        const isOpen = this.sidebar.classList.contains('open');
        if (isOpen) {
            this.sidebar.classList.remove('open');
            this.mobileMenuBtn.setAttribute('aria-expanded', 'false');
        } else {
            this.sidebar.classList.add('open');
            this.mobileMenuBtn.setAttribute('aria-expanded', 'true');
        }
    }

    closeMobileMenu() {
        if (this.sidebar) {
            this.sidebar.classList.remove('open');
        }
        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.setAttribute('aria-expanded', 'false');
        }
    }
}

export const sidebar = new Sidebar();
