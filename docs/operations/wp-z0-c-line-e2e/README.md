# WP-Z0 C-line browser acceptance receipt (public summary)

Date: 2026-07-21
Scope: deployed sandbox quote → address → payment → order flow, plus recovery and authorization checks.

## Result

The acceptance run completed the following behaviour against the deployed application and PostgreSQL-backed state:

1. an authenticated owner confirmed a 3D scene;
2. the owner submitted a customization request;
3. an authorized reviewer approved the request;
4. the system produced and accepted a sandbox quote;
5. the owner confirmed a delivery-address fixture;
6. the sandbox provider exercised failure, retry, and success paths;
7. the resulting sandbox order appeared only for its owner;
8. production payment remained fail-closed.

This receipt does **not** prove a real payment, production job, shipment, or fulfilment. The public snapshot omits production hostnames, cloud account identifiers, real test-user credentials, database row IDs, and screenshots containing personal data. The executable contracts and regression tests remain in `packages/server/tests/` and `web/tests/`.
