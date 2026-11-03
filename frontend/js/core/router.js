export class Router {
    constructor() {
        this.routes = {};
        this.currentPage = null;
    }

    register(pageId, handler) {
        this.routes[pageId] = handler;
    }

    navigate(pageId) {
        if (this.routes[pageId]) {
            this.currentPage = pageId;
            this.routes[pageId]();
        }
    }

    getCurrentPage() {
        return this.currentPage;
    }
}

export const router = new Router();
