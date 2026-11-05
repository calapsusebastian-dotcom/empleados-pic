// Función OPCIONAL: permite que el administrador asigne una contraseña nueva
// a un empleado desde el panel. Requiere el plan Blaze de Firebase
// (pago por uso; este uso cabe en la cuota gratuita mensual).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

// Debe coincidir con ADMIN_EMAILS en public/config.js y con firestore.rules
const ADMIN_EMAILS = ["coocentralempleados@gmail.com"];

exports.cambiarClaveEmpleado = onCall({ region: "us-central1" }, async (req) => {
  const email = req.auth && req.auth.token && req.auth.token.email;
  if (!email || !ADMIN_EMAILS.includes(email.toLowerCase())) {
    throw new HttpsError("permission-denied", "Solo el administrador puede cambiar contraseñas.");
  }
  const { uid, clave } = req.data || {};
  if (typeof uid !== "string" || typeof clave !== "string" || clave.length < 6) {
    throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
  }
  const ficha = await admin.firestore().doc(`empleados/${uid}`).get();
  if (!ficha.exists) {
    throw new HttpsError("not-found", "El empleado no existe.");
  }
  await admin.auth().updateUser(uid, { password: clave });
  return { ok: true };
});
