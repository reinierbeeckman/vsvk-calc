# 🚀 Development Rules & Modern Engineering Best Practices

This file serves as the definitive source of truth for the vsvk-calc project architecture, code quality, and security standards. Every line of code generated must comply with these guidelines.

## 1. Core Architecture & Container Isolation
*   **Separation of Concerns:** Strive for physical and logical boundaries. The architecture consists of a React SPA frontend, a Dotnet BFF, a stateless Dotnet API, Keycloak IDP, and a Postgres database.
*   **12-Factor App Compliance:** 
    *   **Config via Environment:** Never hardcode URLs, connection strings, or secrets. Inject them via environment variables (`.env`).
    *   **Stateless Processes:** The API layer must be 100% stateless. Share nothing. Sessions are managed securely at the BFF layer.
*   **Network Isolation:** Containers must be strictly isolated via Docker Compose networks. The Postgres database must *only* reside on an internal backend network accessible exclusively by the API container.

## 2. Database Design & EF Core Best Practices
*   **True Relational Schema:** No lazy schemaless work. Tabular data must be designed with explicit relational columns, proper foreign keys, and indices. JSONB columns are prohibited for core structured data.
*   **Query Optimization:** 
    *   **No Tracking by Default:** For read-only endpoints, always use `.AsNoTracking()` to reduce memory footprint and context overhead.
    *   **Explicit Projections:** Never return database entities directly to controllers. Always project using LINQ `.Select()` directly inside the query to prevent over-fetching data from Postgres.

## 3. API Design & Security-by-Design (RBAC)
*   **RESTful Standards:** Endpoints must adhere to standard HTTP verbs (`GET`, `POST`, `PUT`, `DELETE`) and return semantic HTTP status codes (`200 OK`, `201 Created`, `400 BadRequest`, `401 Unauthorized`, `403 Forbidden`).
*   **Role-Based Access Control (RBAC):** Security boundaries are enforced via Keycloak claims.
*   **Data Minimization:** Trimming sensitive fields (e.g., `IBAN`, `BtwNummer`) must happen at the data projection layer, not post-fetch.
*   **BAN on Dynamic JSON:** Use of `JsonElement`, `JsonNode`, or `dynamic` to structure or clean data outputs is strictly prohibited. Use C# strongly-typed `record` DTOs.
*   **Fail-Safe Defaults:** If a user role cannot be determined or fails verification, the API must fallback to the most restrictive schema (`VestigingDto` which excludes sensitive fields).

## 4. Modern C# & Clean Code Idioms
*   **Strong Typing over Primitive Obsession:** Use explicit domain types (e.g., `Guid` for IDs) instead of plain strings where applicable.
*   **Immutability:** Use C# positional `record` types for all DTOs and value objects to enforce immutability.
*   **Expressive Code:** Prefer modern C# features such as pattern matching (`switch` expressions), primary constructors, and block-scoped namespaces to reduce visual noise.
*   **Async/Await:** All I/O-bound operations (database, external APIs) must be fully asynchronous (`async/await`) and propagate `CancellationToken` throughout the call stack.

## 5. Test-Driven Development (TDD) & Quality Assurance
*   **TDD Workflow:** Red-Green-Refactor. Write or update unit/integration tests *before* writing the actual implementation logic.
*   **Test Isolation:** Use mock/substitution libraries (e.g., NSubstitute, Moq) to isolate business logic tests from external dependencies like database instances.
*   **Defensive Programming:** Implement strict input validation at the API entry point (e.g., FluentValidation) before processing business logic.
*   **Self-Documenting (OpenAPI):** Every controller action must be decorated with accurate `[ProducesResponseType]` attributes so Swagger UI acts as a precise contract for the SPA frontend.
