/* =========================================================
   Solicitud de Factura — Lógica del formulario
   (versión Google Drive + Google Sheets)

   Los archivos se convierten a base64 en el navegador y se
   envían junto con los datos, como JSON, a un Web App de
   Google Apps Script (ver Codigo.gs). El script sube los
   archivos a Drive, registra la fila en Sheets y te envía
   un correo con los enlaces.
   ========================================================= */

// ==================== CONFIGURACIÓN ====================
// 👉 Pega aquí la URL de implementación (Web App) de tu Google Apps Script.
//    La obtienes al hacer "Implementar > Nueva implementación > Aplicación web".
//    Ver instrucciones completas en README.md de esta carpeta.
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzI7OQI04l9irK1mc3uHQwPl8GduNIMi4AvYLNhCE3lcCcE2mcGq6Xsortf1y-lLLwa/exec';
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('invoiceForm');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const spinner = document.getElementById('spinner');
  const alertError = document.getElementById('alertError');
  const successBox = document.getElementById('successBox');

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const EXT_PERMITIDAS = ['pdf', 'jpg', 'jpeg', 'png'];

  // Marca el momento en que se cargó el formulario (para detectar bots que envían al instante)
  document.getElementById('loadedAt').value = Date.now();

  bindUpload('csf', 'nameCSF', 'boxCSF');
  bindUpload('comprobante', 'namePago', 'boxPago');

  // Activa clic/arrastrar-y-soltar sobre la zona de carga de archivos
  function bindUpload(inputId, nameId, boxId) {
    const input = document.getElementById(inputId);
    const nameEl = document.getElementById(nameId);
    const box = document.getElementById(boxId);

    input.addEventListener('change', () => mostrarNombreArchivo(input, nameEl, box));

    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  }

  function mostrarNombreArchivo(input, nameEl, box) {
    const file = input.files[0];
    if (!file) return;
    nameEl.textContent = '✔ ' + file.name;
    nameEl.style.display = 'block';
    box.style.borderColor = '#10b981';
    input.closest('.field').classList.remove('invalid');
  }

  // Valida tipo y tamaño de un archivo; retorna el mensaje de error o null si es válido
  function validarArchivo(input) {
    const file = input.files[0];
    if (!file) return 'Este archivo es obligatorio.';
    const ext = file.name.split('.').pop().toLowerCase();
    if (!EXT_PERMITIDAS.includes(ext) || !TIPOS_PERMITIDOS.includes(file.type)) {
      return 'Formato no permitido. Usa PDF, JPG o PNG.';
    }
    if (file.size > MAX_SIZE) {
      return 'El archivo supera el tamaño máximo de 10 MB.';
    }
    return null;
  }

  function marcarError(id, mensaje) {
    const field = document.getElementById(id).closest('.field');
    field.classList.add('invalid');
    if (mensaje) {
      const errEl = field.querySelector('.error-text');
      if (errEl) errEl.textContent = mensaje;
    }
  }

  function limpiarErrores() {
    document.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
    alertError.classList.remove('show');
  }

  function validarFormulario() {
    let valido = true;
    limpiarErrores();

    ['nombre', 'folio', 'fechaPago', 'monto', 'metodoPago'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el.value.trim()) { marcarError(id); valido = false; }
    });

    const correo = document.getElementById('correo');
    const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regexCorreo.test(correo.value.trim())) { marcarError('correo'); valido = false; }

    const errCSF = validarArchivo(document.getElementById('csf'));
    if (errCSF) {
      document.getElementById('errCSF').textContent = errCSF;
      marcarError('csf');
      valido = false;
    }

    const errPago = validarArchivo(document.getElementById('comprobante'));
    if (errPago) {
      document.getElementById('errPago').textContent = errPago;
      marcarError('comprobante');
      valido = false;
    }

    // Protección anti-spam en el cliente: honeypot y envío demasiado rápido
    const honeypot = document.getElementById('website').value;
    const tiempoTranscurrido = Date.now() - Number(document.getElementById('loadedAt').value);
    if (honeypot || tiempoTranscurrido < 2500) {
      valido = false;
    }

    return valido;
  }

  function mostrarCarga(activo) {
    submitBtn.disabled = activo;
    btnText.style.display = activo ? 'none' : 'inline';
    spinner.style.display = activo ? 'block' : 'none';
  }

  function mostrarError(mensaje) {
    alertError.textContent = mensaje;
    alertError.classList.add('show');
  }

  // Convierte un archivo a base64 (sin el prefijo "data:...;base64,")
  function archivoABase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validarFormulario()) return;

    mostrarCarga(true);
    try {
      const csfFile = document.getElementById('csf').files[0];
      const pagoFile = document.getElementById('comprobante').files[0];
      const [csfBase64, pagoBase64] = await Promise.all([
        archivoABase64(csfFile),
        archivoABase64(pagoFile)
      ]);

      const payload = {
        nombre: document.getElementById('nombre').value.trim(),
        correo: document.getElementById('correo').value.trim(),
        telefono: document.getElementById('telefono').value.trim(),
        folio: document.getElementById('folio').value.trim(),
        fechaPago: document.getElementById('fechaPago').value,
        monto: document.getElementById('monto').value,
        metodoPago: document.getElementById('metodoPago').value,
        observaciones: document.getElementById('observaciones').value.trim(),
        website: document.getElementById('website').value,
        loadedAt: document.getElementById('loadedAt').value,
        csf: { name: csfFile.name, mimeType: csfFile.type, base64: csfBase64 },
        comprobante: { name: pagoFile.name, mimeType: pagoFile.type, base64: pagoBase64 }
      };

      // Content-Type "text/plain" evita que el navegador dispare una petición
      // preflight (OPTIONS), que Google Apps Script no maneja de forma nativa.
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.success) {
        form.style.display = 'none';
        successBox.style.display = 'block';
      } else {
        mostrarError(json.message || 'No se pudo procesar tu solicitud. Intenta de nuevo.');
        mostrarCarga(false);
      }
    } catch (err) {
      mostrarError('Ocurrió un error de conexión. Intenta de nuevo.');
      mostrarCarga(false);
    }
  });
});
