// Main Application Entry Point
import { apiClient } from './api/api-client.js';
import { login, getCurrentUser, logout } from './api/auth-api.js';
import { notifications } from './core/notifications.js';
import { sidebar } from './components/sidebar.js';
import { $ } from './utils/dom.js';
import { getErrorMessage } from './utils/errors.js';

class App {
    constructor() {
        this.currentUser = null;
        this.init();
    }

    init() {
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
            this.checkAuth();
        });
    }

    setupEventListeners() {
        // Login form
        const loginForm = $('#loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        // Logout button
        const logoutBtn = $('#logoutButton');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }

        // Password toggle
        const toggleLoginPassword = $('#toggleLoginPassword');
        if (toggleLoginPassword) {
            toggleLoginPassword.addEventListener('click', () => {
                const passwordInput = $('#loginPassword');
                if (passwordInput) {
                    if (passwordInput.type === 'password') {
                        passwordInput.type = 'text';
                        toggleLoginPassword.textContent = 'Hide';
                    } else {
                        passwordInput.type = 'password';
                        toggleLoginPassword.textContent = 'Show';
                    }
                }
            });
        }

        // Navigation
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const pageId = item.getAttribute('data-page');
                if (pageId) {
                    this.showPage(pageId);
                }
            });
        });

        // Go buttons
        document.querySelectorAll('[data-go]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pageId = btn.getAttribute('data-go');
                if (pageId) {
                    this.showPage(pageId);
                }
            });
        });
    }

    async handleLogin() {
        const email = $('#loginEmail')?.value;
        const password = $('#loginPassword')?.value;
        const loginBtn = $('#loginButton');
        const loginMessage = $('#loginMessage');

        if (!email || !password) {
            this.showLoginMessage('Please enter both email and password', 'error');
            return;
        }

        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Logging in...';
        }

        try {
            await login(email, password);
            await this.loadCurrentUser();
            this.showLoginMessage('Login successful', 'success');
            this.showApplication();
        } catch (error) {
            this.showLoginMessage(getErrorMessage(error), 'error');
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        }
    }

    showLoginMessage(message, type) {
        const loginMessage = $('#loginMessage');
        if (loginMessage) {
            loginMessage.textContent = message;
            loginMessage.className = `form-message ${type}`;
        }
    }

    handleLogout() {
        logout();
        this.showLoginPage();
    }

    showLoginPage() {
        $('#loginPage')?.classList.remove('hidden');
        $('#application')?.classList.add('hidden');
        $('#teacherNavigation')?.classList.add('hidden');
        $('#adminNavigation')?.classList.add('hidden');
    }

    showApplication() {
        $('#loginPage')?.classList.add('hidden');
        $('#application')?.classList.remove('hidden');
        if (!this.currentUser) {
            this.showLoginPage();
            return;
        }
        this.applyRoleUI();
        this.updateUserUI();
        this.showPage(this.currentUser.role === 'admin' ? 'admin-dashboard' : 'teacher-dashboard');
    }

    async loadCurrentUser() {
        try {
            this.currentUser = await getCurrentUser();
            this.applyRoleUI();
            this.updateUserUI();
        } catch (error) {
            if (error.status === 401) apiClient.clearSession();
            this.currentUser = null;
            this.showLoginPage();
            if (error.status !== 401) throw error;
        }
    }

    applyRoleUI() {
        const isAdmin = Boolean(this.currentUser && this.currentUser.role === 'admin');
        $('#teacherNavigation')?.classList.toggle('hidden', isAdmin);
        $('#adminNavigation')?.classList.toggle('hidden', !isAdmin);
        document.querySelectorAll('[data-admin]').forEach(el => {
            el.classList.toggle('hidden', !isAdmin);
        });
    }

    updateUserUI() {
        if (!this.currentUser) return;
        const name = this.currentUser.name || this.currentUser.email || '';
        const updates = {
            sidebarUserName: name,
            sidebarUserRole: this.currentUser.role || '',
            topbarUserName: name,
            teacherWelcomeName: name,
            profileName: name,
            profileEmail: this.currentUser.email || ''
        };
        Object.entries(updates).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        const avatar = document.getElementById('sidebarAvatar');
        if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    }

    showPage(pageId) {
        if (!apiClient.getToken()) {
            this.showLoginPage();
            return;
        }

        document.querySelectorAll('.page-section').forEach(section => {
            section.classList.add('hidden');
        });

        const selectedPage = document.getElementById(pageId);
        if (!selectedPage) {
            console.error('Page not found:', pageId);
            return;
        }

        selectedPage.classList.remove('hidden');

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const activeNav = document.querySelector(`[data-page="${pageId}"]`);
        if (activeNav) {
            activeNav.classList.add('active');
        }

        // Update page title
        const pageTitles = {
            'teacher-dashboard': { title: 'Dashboard', subtitle: 'Overview of your question paper generation system' },
            'teacher-subjects': { title: 'My Subjects', subtitle: 'Subjects registered in the system' },
            'teacher-questions': { title: 'Question Bank', subtitle: 'Manage your question bank' },
            'teacher-pyqs': { title: 'PYQs', subtitle: 'Upload PDFs, process them and extract questions' },
            'teacher-generate': { title: 'Generate Question Paper', subtitle: 'Create a question paper using AI-assisted analysis' },
            'teacher-papers': { title: 'My Papers', subtitle: 'View and manage generated question papers' },
            'teacher-profile': { title: 'Profile', subtitle: 'Manage your profile information' },
            'teacher-help': { title: 'Help', subtitle: 'Get help with the question paper generator' }
        };

        const info = pageTitles[pageId];
        if (info) {
            const pageTitle = $('#pageTitle');
            const pageSubtitle = $('#pageSubtitle');
            if (pageTitle) pageTitle.textContent = info.title;
            if (pageSubtitle) pageSubtitle.textContent = info.subtitle;
        }

        sidebar.closeMobileMenu();
    }

    async checkAuth() {
        if (apiClient.getToken()) {
            await this.loadCurrentUser();
            this.showApplication();
        } else {
            this.showLoginPage();
        }
    }
}

new App();
