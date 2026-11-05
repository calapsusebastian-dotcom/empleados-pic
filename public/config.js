// ============================================================
//  CONFIGURACIÓN — edite este archivo antes de desplegar
// ============================================================

// 1) Pegue aquí la configuración de su app web de Firebase.
//    Consola de Firebase → ⚙ Configuración del proyecto → General →
//    "Tus apps" → app web → "Configuración del SDK" → opción "Config".
export const firebaseConfig = {
  apiKey: "AIzaSyBIvqXZCJdqqhfXeTRf19XwS2xd9N_yC9I",
  authDomain: "registro-pic-empleados.firebaseapp.com",
  projectId: "registro-pic-empleados",
  storageBucket: "registro-pic-empleados.firebasestorage.app",
  messagingSenderId: "137693115175",
  appId: "1:137693115175:web:a2c83c9b6a6bd8ed0d2f02"
};

// 2) Correo(s) del administrador, en minúsculas.
//    Deben ser EXACTAMENTE los mismos que en firestore.rules
//    (y en functions/index.js si usa la función opcional).
export const ADMIN_EMAILS = [
  "coocentralempleados@gmail.com"
];

// 3) Dominio interno para los usuarios de los empleados.
//    El empleado escribe "mlopez" y el sistema entra como
//    "mlopez@personal.miempresa.app". No necesita existir ni recibir correo.
export const DOMINIO_USUARIOS = "personal.registro-pic.app";

// 4) Región de la función opcional para restablecer contraseñas.
export const REGION_FUNCIONES = "us-central1";
