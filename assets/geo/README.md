# Geometría de las 32 entidades federativas

`mx-estados.json` — contornos de las 32 entidades federativas de México (incluida la Ciudad de México) para el
**Mapa de viajes** (`src/ui/screens/tripsMap.js`).

- **Fuente:** Natural Earth, *Admin 1 – States, Provinces*, escala 1:10m (https://www.naturalearthdata.com).
  Natural Earth es de **dominio público**: se puede usar, modificar y distribuir sin restricciones.
- **Proyección:** cónica conforme de Lambert del INEGI (EPSG:6372, GRS80; paralelos 17.5° y 29.5°, origen 12° N, 102° O).
- **Proceso:** se tomaron las 32 entidades de México (sin las islas en disputa), se quitaron islotes de menos de 40 km²,
  se simplificó con mapshaper conservando la topología (22 %) y se escaló a un dibujo de 1000 px de ancho.
- **Claves:** cada entidad trae su clave ISO 3166-2 (`MX-JAL`); la app la relaciona con la clave oficial del INEGI
  (`14`) en `src/domain/geo/mexico.js`. Los datos de viajes nunca se guardan en este archivo.
- `proj` guarda los parámetros para convertir coordenadas proyectadas al dibujo (`project()` en `mexico.js`).
