# Archived implementation

This is the superseded billing-plan implementation. It is not imported by the app,
listed in firebase.json, installed by the root package, or used by current tests.
Do not deploy it for the Spark-plan app. Current account operations use the
Firestore JS SDK and firestore.rules; Google authorization is client-side.
