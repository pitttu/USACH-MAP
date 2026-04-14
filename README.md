# USACH-MAP

> Mapa interactivo de alta fidelidad para la comunidad universitaria. Enfoque en confiabilidad, precisión cartográfica y usabilidad.

USACH-MAP es una herramienta de cartografía digital diseñada para mejorar la navegación dentro del campus de la Universidad de Santiago de Chile. El proyecto surge como una evolución técnica a las soluciones existentes, integrando múltiples fuentes de datos en una interfaz cohesiva y minimalista.

## Core Features

* **Custom Internal Routing:** Implementación de una capa propia de caminos peatonales internos que conecta puntos de interés no indexados en mapas comerciales (Google Maps/Mapbox standard).
* **Unified Data Sources:** Agregación y limpieza de datos provenientes de OpenStreetMap (OSM), Google Maps y el proyecto comunitario USACH Premium.
* **Familiar Interface:** Diseño de UI/UX inspirado en estándares de la industria para garantizar una curva de aprendizaje nula.
* **Zero Footprint:** Aplicación web estática, gratuita y sin necesidad de instalación.

## Stack Técnico

El proyecto se basa en tecnologías web estándar, priorizando el rendimiento y la compatibilidad:

* **Frontend:** JavaScript (ES6+), HTML5, CSS3/SCSS.
* **Engine:** Mapbox GL JS API.
* **Data:** OpenStreetMap Contributor Data.
* **Hosting:** GitHub Pages.

## Despliegue y Uso

La aplicación se encuentra desplegada y operativa en la siguiente URL:
https://pitttu.github.io/USACH-MAP

Para replicar el entorno de desarrollo localmente:

```bash
git clone [https://github.com/pitttu/USACH-MAP.git](https://github.com/pitttu/USACH-MAP.git)
cd USACH-MAP
# DESPLEGAR EN PYTHON :)