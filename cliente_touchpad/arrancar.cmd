@echo off
rem Lanzador de la aplicacion del touchpad. Doble clic y listo.
cd /d "%~dp0.."
".venv\Scripts\python.exe" "cliente_touchpad\servidor.py" --puerto 8771
pause
