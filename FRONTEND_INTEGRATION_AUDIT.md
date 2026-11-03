# FRONTEND INTEGRATION AUDIT - MasterDeOrca
Audit Date: 2026-11-03

## 1. FRONTEND STRUCTURE

### 1.1 Pages/Routes (from frontend/index.html + router logic)
Routes identified in vercel.json and index.html routing:
- /login (login page)
- /dashboard -> admin-dashboard or teacher-dashboard
- /subjects -> teacher-subjects/admin-subjects
- /question-bank -> teacher-questions
- /pyqs -> teacher-pyqs
- /generate-paper -> teacher-generate
- /my-papers -> teacher-papers/admin-papers
- /teachers -> admin-teachers
- /profile -> teacher-profile/admin-profile
- /help -> teacher-help
- /activity -> admin-activity
- /settings (defined in vercel.json, no corresponding section found)

Sections/pages present in frontend/index.html:
- loginPage
- application with sidebar navigation
- teacher-dashboard, teacher-subjects, teacher-questions, teacher-pyqs, teacher-generate, teacher-papers, teacher-profile, teacher-help
- admin-dashboard, admin-teachers, admin-subjects, admin-papers, admin-activity, admin-profile
- Various modals: confirmDialog, teacherDialog, questionEditorModal, pyqQuestionDetailDialog, pyqResultDialog, sourceDetailModal, figurePreviewModal, addQuestionModal

### 1.2 Components & UI Elements
- Sidebar with role-based navigation (teacherNavigation/adminNavigation)
- Topbar with page title/subtitle, user info
- Modals/dialogs for confirmations, teacher management, question editing, details
- Forms for login, teacher creation/edit, question bank, paper generation
- Tables for teachers, questions, papers, PYQs
- Cards for dashboard stats, subjects, etc.

### 1.3 JavaScript Modules
**API Layer (frontend/js/api/):**
- api-client.js - shared HTTP client with auth, error handling, logging
- auth-api.js - login, getCurrentUser, logout
- subjects-api.js - subjects CRUD
- teachers-api.js - teachers CRUD
- question-bank-api.js - question bank operations

**Core:**
- config.js - API base resolution
- notifications.js, router.js (referenced), etc.

**Utils:**
- dom.js, errors.js, formatters.js, validators.js

**Main:**
- app.js (frontend/js/app.js) - ES module app with login flow
- Also script.js (root) and frontend/index.html has inline/linked scripts

### 1.4 Authentication & Token Management
- Token stored in sessionStorage with key from config (TOKEN_KEY = "qpg_token")
- api-client attaches Bearer token to requests if present
- On 401, clears session and calls onUnauthorized
- login() in auth-api sets token via apiClient.setToken()
- getCurrentUser() calls GET /auth/me
- logout() clears session

### 1.5 State Management
- Primarily DOM-based state in script.js (large monolith)
- Some module state in ES modules (app.js)
- Caches: subjectsCache, teachersCache, questionsCache, blueprints, etc.
- currentUser stored in app state

### 1.6 Navigation
- Hash/route-based via history API
- Role-based navigation shown/hidden
- Permission checks added in showPage() for teacher routes


## 2. FEATURE-BY-FEATURE INVESTIGATION

### 2.1 Login and Authentication
- **Files:** frontend/index.html (loginPage), frontend/js/api/auth-api.js, frontend/js/app.js, script.js
- **Purpose:** User authentication with email/password, optional TOTP
- **Interactions:** Submit login form, password toggle
- **API:** POST /auth/login {email, password} → {access_token, token_type}
- **Auth:** None for login; token attached after
- **Token:** Stored in sessionStorage via apiClient
- **Flow:** login() sets token, getCurrentUser() fetches profile, role determines navigation
- **Status:** IMPLEMENTED (with TOTP support in script.js)

### 2.2 Dashboard
- **Files:** index.html (teacher-dashboard, admin-dashboard), script.js
- **Purpose:** Overview with stats and quick actions
- **API calls:** GET /subjects (for counts), GET /teachers (admin stats), GET /api/dashboard/metrics (with fallbacks)
- **Status:** IMPLEMENTED with fallbacks

### 2.3 Subject Selection and Management
- **Files:** index.html (teacher-subjects, admin-subjects), script.js
- **APIs:** GET /subjects (admin), POST /subjects, PATCH /subjects/{subject}, DELETE /subjects/{subject}
- **Teachers:** Get subjects from blueprints or assignments/permissions
- **Status:** IMPLEMENTED

### 2.4 Teacher and User Management
- **Files:** index.html (admin-teachers), script.js, frontend/js/api/teachers-api.js
- **APIs:** GET /teachers, POST /teachers, PATCH /teachers/{id}, DELETE /teachers/{id}
- **Features:** List with filters/pagination, add/edit/delete, approve/disapprove
- **Status:** IMPLEMENTED

### 2.5 Subject Assignments and Permissions
- **Files:** script.js (added assignment UI)
- **APIs (attempted):** GET /teachers/{id}/subjects or /assignments/teacher/{id}, PUT /teachers/{id}/subjects or /assignments/teacher/{id}, GET /users/{id}/subjects or /teachers/me/subjects
- **Features:** Assign subjects with permissions (access papers, upload/process, manage bank, generate) - UI added
- **Status:** UI IMPLEMENTED, API endpoints may be MISSING/MISMATCHED depending on backend

### 2.6 Document Uploads
- **Files:** index.html (PYQs section), script.js
- **API:** POST /subjects/{subject}/pdfs (multipart files)
- **Status:** IMPLEMENTED

### 2.7 PDF Processing
- **API:** POST /subjects/{subject}/pdfs/{filename}/process
- **Status:** IMPLEMENTED

### 2.8 Processing Jobs and Status
- **API:** GET /jobs/{job_id}, GET /subjects/{subject}/pdfs/{filename}/status
- **Status:** IMPLEMENTED with polling

### 2.9 Question Bank
- **API:** GET /api/question-bank, GET /api/question-bank/{id}, POST/PATCH/DELETE operations
- **Status:** IMPLEMENTED

### 2.10 Question Management and Priorities
- **API:** PUT /api/question-priorities, GET /api/question-priorities
- **Status:** IMPLEMENTED

### 2.11 Blueprints and Paper Configuration
- **API:** GET/POST/PATCH/DELETE /blueprints or /api/question-paper/blueprints
- **Status:** IMPLEMENTED

### 2.12 Question Paper Generation
- **API:** POST /api/question-papers/generate
- **Status:** IMPLEMENTED

### 2.13 Generated Paper Preview and Downloads
- **API:** GET /api/question-papers/{id}/docx, GET /api/question-papers/history
- **Status:** IMPLEMENTED

### 2.14 Basic Configurations
- **API:** GET/POST/PATCH/DELETE /api/ui-configurations
- **Status:** IMPLEMENTED

### 2.15 UI Configurations
- Covered under basic configurations
- **Status:** IMPLEMENTED

### 2.16 Administrative Features
- Access mode, teacher management, subjects - IMPLEMENTED

## 3. BACKEND INTEGRATION AUDIT

### API Base Configuration
- **frontend/js/config.js:** Resolves API base from window/env/meta; defaults to localhost:8000 in dev, https://qpengine-6f07.onrender.com in production. Preserves localhost for dev. (MODIFIED)
- **frontend/js/api/api-client.js:** Uses API_BASE from config, attaches Bearer token, handles errors
- **Status:** PRODUCTION URL SET (Render) - appears configured

### Integration Status by Area

| Feature | Endpoint(s) | Method | Status | Notes |
|---------|-------------|---------|--------|-------|
| Login | /auth/login | POST | MATCHED | Implemented |
| Current User | /auth/me | GET | MATCHED | Implemented |
| Health | /health | GET | MATCHED | Public endpoint |
| Subjects List | /subjects | GET | MATCHED | Admin or per permissions |
| Create Subject | /subjects | POST | MATCHED | Admin |
| Update/Delete Subject | /subjects/{name} | PATCH/DELETE | MATCHED | Admin |
| Teachers | /teachers | GET/POST/PATCH/DELETE | MATCHED | Admin |
| Teacher Assignments | /teachers/{id}/subjects, /assignments/teacher/{id} | GET/PUT | UNVERIFIED/MISSING BACKEND | UI added with fallbacks - endpoints may not exist on backend |
| User Assignments | /users/{id}/subjects, /teachers/me/subjects | GET | UNVERIFIED/MISSING BACKEND | UI added with fallbacks |
| PDFs Upload/List | /subjects/{s}/pdfs | GET/POST | MATCHED | Admin-gated per backend |
| PDF Process | /subjects/{s}/pdfs/{f}/process | POST | MATCHED | Admin |
| Jobs | /jobs/{id}, /subjects/{s}/pdfs/{f}/status | GET | MATCHED | Admin |
| PDF Result | /subjects/{s}/pdfs/{f}/result | GET | MATCHED | Admin |
| PDF Reconstruct/Download | /subjects/{s}/pdfs/{f}/reconstruct, /reconstruction | POST/GET | MATCHED | Admin |
| Question Bank | /api/question-bank* | GET/POST/PATCH/DELETE | MATCHED | Per backend docs |
| Priorities | /api/question-priorities* | GET/PUT/DELETE | MATCHED | Per backend docs |
| Blueprints | /blueprints or /api/question-paper/blueprints | CRUD | MATCHED | Per backend docs |
| Generate Paper | /api/question-papers/generate | POST | MATCHED | Per backend docs |
| Drafts | /api/question-papers/drafts* | CRUD | MATCHED | Per backend docs |
| Paper History/Download | /api/question-papers/history, /api/question-papers/{id}/docx | GET/DELETE | MATCHED | Per backend docs |
| UI Configs | /api/ui-configurations* | CRUD | MATCHED | Per backend docs |

### Issues Found
- **Assignment/Permission endpoints:** UI implements calls to assignment endpoints that may not exist on backend - fallbacks added but classification UNVERIFIED
- **Subject ID vs Name:** Some places use subject names, some use IDs - backend expects names in paths per docs
- **Admin-gated routes:** Many teacher operations are admin-gated on backend; UI now adds permission checks but backend still enforces
- **Hardcoded localhost:** Only in config fallback (dev) and docs - code uses config

## 4. FRONTEND CONFIGURATION AND UX AUDIT

### Configuration
- **Production URL:** https://qpengine-6f07.onrender.com (set as default in production)
- **Local dev:** http://localhost:8000 (preserved)
- **API Client:** Shared api-client.js used throughout
- **CORS:** Frontend must be served from allowed origin; backend CORS needs to allow deployed frontend origin (noted as requirement)
- **Tokens:** JWT Bearer attached correctly

### UX
- Loading states present (spinners, loading messages)
- Error handling with toasts and inline messages
- Empty states implemented
- Form validation present
- Role-based navigation
- Permission-based restrictions added
- Responsive styles present

### Issues
- Some features may show UI for endpoints that don't exist (assignments/permissions)
- Backend authorization is primary; frontend restrictions added but not sufficient alone

## 5. PRIORITIZED ISSUES

### Critical
1. **Assignment/Permission API endpoints** - UI calls assignment endpoints that may not exist on backend; need verification against actual backend API
2. **CORS configuration** - Backend must allow deployed frontend origin with credentials (not wildcard)

### High
1. **Subject ID vs Name consistency** - Ensure correct usage per backend expectations
2. **Admin-gated operations** - Teachers may hit 403s for admin-only endpoints; UI permissions added but backend enforces
3. **API error handling** - Some error paths could be improved

### Medium
1. **Missing routes** - /settings route in vercel.json has no corresponding page
2. **Fallback logic** - Multiple fallbacks may mask real issues

### Low
1. **Documentation** - Update docs to reflect current API base
2. **Code organization** - Large monolithic script.js could be refactored (not required)

## Notes
- Audit based on actual code inspection
- Distinction made between verified and unverified behavior
- No source code modified during audit
