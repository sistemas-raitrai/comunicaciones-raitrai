# Comunicaciones Rai Trai

Portal móvil para lectura de pulseras NFC y consulta operativa de pasajeros.

## Archivos

- `index.html`
- `estilos.css`
- `lector-pulseras.js`
- `config.js`
- `vercel.json`

## Configuración

Antes de usar el portal, edita `config.js` y reemplaza:

```text
PEGAR_URL_CLOUD_FUNCTION_AQUI
```

por la URL desplegada de la función:

```text
consultarPulseraPublica
```

## Flujo

1. El usuario abre el portal desde un teléfono Android.
2. Ingresa el número de negocio.
3. Presiona **Leer pulsera NFC**.
4. Acerca la pulsera.
5. El portal consulta la Cloud Function.
6. Si la pulsera es individual, muestra el pasajero.
7. Si la pulsera es grupal, muestra una lista para buscar al pasajero.

## Requisitos NFC

- Android.
- Google Chrome.
- NFC activado.
- Sitio publicado mediante HTTPS.
- Pulseras compatibles con NDEF.
