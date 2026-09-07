# Apuestas de Caballeros

App para registrar y tomar apuestas entre un grupo de usuarios, con folios/tickets
por cada operación y un panel de administración separado.

## Qué incluye esta versión

- Login de **usuario** (crea y toma apuestas) y de **administrador** (da de alta
  usuarios, cambia sus propias credenciales, supervisa todas las apuestas).
- El administrador **no puede apostar** — ni siquiera intentándolo desde fuera de
  la interfaz, el servidor lo bloquea.
- Registrar apuesta: categoría, partido/situación, a qué le apuestas, monto,
  cuántas veces se tomará, y condiciones de pago opcionales (**pago al doble**
  o **pago al triple**, mutuamente excluyentes).
- Autocompletar en "partido/situación" y "a qué le apuestas" con lo que ya
  escribieron otros usuarios.
- Cada apuesta registrada y cada apuesta tomada genera un **ticket/folio**
  (`REG-0001`, `TCK-0002`, etc).
- Los datos se guardan en el servidor (archivo `server/data/db.json`), así que
  **todos los usuarios ven las mismas apuestas sin importar el dispositivo**
  desde el que entren — esto es justo lo que la versión de un solo HTML sin
  servidor no podía hacer.
- Las contraseñas se guardan encriptadas (bcrypt) y la sesión usa JWT — a
  diferencia del prototipo anterior, aquí sí es una autenticación real.

## Qué NO incluye todavía (lo dejamos pendiente a propósito)

- Registro o confirmación de depósitos/pagos (dijiste que eso lo manejas por
  fuera).
- Cálculo automático de resultados/liquidación con el 5% de comisión de la
  casa que mencionaste al principio del proyecto — esa lógica ya la habíamos
  construido antes y se puede reincorporar cuando quieras.

## Correrlo en tu computadora (para seguir probando y editando)

```bash
cd server
npm install
npm start
```

Abre:
- App de usuarios: `http://localhost:3000/`
- Panel admin: `http://localhost:3000/admin.html`

**Usuario administrador por defecto** (cámbialo en cuanto entres, desde
"Mi cuenta"):
- Usuario: `admin`
- Contraseña: `admin123`

## Subirlo a Railway

1. Sube esta carpeta completa a un repositorio de GitHub (o usa el CLI de
   Railway para desplegar directo desde tu computadora).
2. En Railway: **New Project → Deploy from GitHub repo**, selecciona el repo.
3. Railway detecta automáticamente que es un proyecto Node (por el
   `package.json` dentro de `server/`). Como el proyecto vive en la subcarpeta
   `server/`, configúralo así en Railway:
   - **Root Directory**: `server`
   - **Start Command**: `npm start` (ya viene definido en package.json)
4. Agrega la variable de entorno `JWT_SECRET` con un valor secreto propio
   (cualquier texto largo y aleatorio). Si no la defines, la app usa un valor
   por defecto que **no** es seguro para producción.
5. **Importante sobre persistencia**: esta versión guarda los datos en un
   archivo (`server/data/db.json`) en el disco del contenedor. Railway, por
   defecto, puede reiniciar ese disco en cada despliegue nuevo, lo que
   borraría usuarios y apuestas. Para evitarlo:
   - Agrega un **Volume** en Railway y móntalo en la ruta `server/data`
     (así los datos sobreviven a los redespliegues), o
   - Si el proyecto crece, migra `db.js` para usar una base de datos real
     (Railway ofrece PostgreSQL con un clic) — es un cambio acotado porque
     toda la lectura/escritura de datos ya está centralizada en `db.js`.
6. Una vez desplegado, Railway te da una URL pública (algo como
   `tuapp.up.railway.app`). Esa es la que compartes con tus amigos.

## Notas de seguridad para un grupo de amigos

- Cambia la contraseña del admin apenas lo despliegues.
- Cambia `JWT_SECRET` a algo propio antes de usarlo en producción.
- No hay límite de intentos de login todavía; para un grupo cerrado de amigos
  no es crítico, pero es algo a agregar si el grupo crece.
