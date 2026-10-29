# Auditoría funcional — Staffing TheHouse (29-oct-2026)

Revisión del código (sin pruebas en navegador) de las 12 pestañas del sidebar.
Impacto = riesgo para la experiencia del usuario. **Alto:** se pierden o dañan datos, o falla una función principal. **Medio:** confunde o falla en casos comunes. **Bajo:** casos raros o menores.

## Resumen

| Pestaña | Alto | Medio | Bajo | Total |
|---|---|---|---|---|
| Inicio | 0 | 3 | 4 | 7 |
| Tablero | 4 | 8 | 5 | 17 |
| Proyectos | 3 | 8 | 3 | 14 |
| Personas | 3 | 8 | 9 | 20 |
| Ausencias | 1 | 6 | 6 | 13 |
| Alertas | 0 | 3 | 3 | 6 |
| Anotaciones | 1 | 3 | 3 | 7 |
| Reportes | 1 | 2 | 6 | 9 |
| Planificación *(apagada hoy)* | 5 | 3 | 3 | 11 |
| Capacity | 0 | 2 | 3 | 5 |
| Accesos | 0 | 3 | 3 | 6 |
| Configuración | 0 | 1 | 1 | 2 |
| **Total** | **18** | **50** | **49** | **117** |

---

## Inicio
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| El % de ocupación del panel Equipo, la lista "Disponibles próximamente" y el "Perfil individual" cuentan asignaciones de proyectos archivados o en la papelera. Archivar un proyecto no cierra sus asignaciones, así que esas personas siguen viéndose ocupadas y no aparecen como disponibles (InicioClient.tsx:163-173, 227-245; PerfilIndividualTablero.tsx:210-214; lib/queries/engagements.ts:177-187) | Contar solo proyectos activos y fuera de la papelera, o cerrar las asignaciones al archivar o eliminar | Medio |
| Una persona que solo está en un "Posible proyecto" sale con 0% en Equipo, pero no aparece como disponible (InicioClient.tsx:169-173 vs 163-168; DisponiblesTablero.tsx:72-93) | Excluir también los "Posibles proyectos" en la consulta de Disponibles | Medio |
| Si una asignación quedó partida en dos tramos por vacaciones, el Perfil individual muestra solo el primero. El proyecto desaparece después de la ausencia y el % mostrado queda mal (PerfilIndividualTablero.tsx:247-252) | Guardar todos los tramos y pintar la barra si cualquiera de ellos cae en la columna | Medio |
| Si falla la carga del Perfil o del calendario de Ausencias, aparece "Sin actividad" o "—" en vez de un aviso de error (PerfilIndividualTablero.tsx:208-221; GanttAusencias.tsx:146-154) | Mostrar "No se pudieron cargar los datos" | Bajo |
| El calendario de Ausencias muestra a GyD, AySr y planificador las "vacaciones por confirmar", pero el Tablero y el Perfil se las ocultan (GanttAusencias.tsx:148-154 vs PerfilIndividualTablero.tsx:147, 282-284) | Aplicar el mismo filtro por rol | Bajo |
| El rango de fechas del encabezado anuncia un mes o un día de más (InicioClient.tsx:127-132) | Calcularlo con la última columna que realmente se ve | Bajo |
| Si falla "Descargar Resumen Imagen", no aparece ningún aviso (DesgloceEngagements.tsx:853-855) | Mostrar un mensaje de error | Bajo |

## Tablero
*(El cuadrante Tablero de Inicio usa este mismo componente, así que estos fallos también aparecen ahí.)*
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| Al estirar o acortar la barra de un proyecto, **todas** sus asignaciones y cargos quedan con la misma fecha. Se pierden las fechas propias de cada persona, quienes ya estaban desasignadas vuelven a quedar asignadas, y "Deshacer" no recupera nada (lib/queries/engagements.ts:195-207; DesgloceEngagements.tsx:1786, 584) | Mover solo las asignaciones que quedan fuera del rango nuevo, recortándolas al borde, y guardar las fechas anteriores para poder deshacer | Alto |
| Si la asignación de una persona está partida en tramos, las manillas, la "×" de desasignar y el ✓ de confirmar actúan sobre un tramo que puede no ser el que se ve. Resultado: ocupación duplicada, fechas al revés o la persona sigue asignada (DesgloceEngagements.tsx:2208, 2760-2767, 2866-2879, 1835-1846) | Usar el tramo de la columna donde se hizo clic, o aplicar la acción a todos los tramos de esa persona | Alto |
| "Deshacer" una edición del proyecto borra todos los cargos requeridos y los vuelve a crear sin revisar errores. Si algo falla, los cargos se pierden sin aviso (DesgloceEngagements.tsx:605-612, 569, 579-581, 595-598) | Hacerlo en una sola operación atómica en la base y mostrar el error si falla | Alto |
| En "Desarrollo interno", el círculo punteado crea un cupo y una asignación con un solo clic, sin confirmar, incluso para el planificador, que en pantalla es solo lectura (DesgloceEngagements.tsx:2662-2672, 1473-1489) | Ocultar ese círculo en modo solo lectura y pedir confirmación antes de crear | Alto |
| Con un proyecto colapsado, un usuario de solo lectura puede arrastrar la barra o cambiar el color. El cambio no se guarda y casi nunca hay aviso (DesgloceEngagements.tsx:2475-2499) | Aplicar la misma restricción de solo lectura que en la vista expandida | Medio |
| "¿Último día de trabajo?" acepta cualquier fecha, incluso antes del inicio o después del fin (DesgloceEngagements.tsx:3372-3389, 1524-1537) | Limitar la fecha entre el inicio y el fin de la asignación | Medio |
| Al arrastrar los bordes se puede dejar el inicio después del fin (DesgloceEngagements.tsx:1752-1786, 1815-1846) | Rechazar el cambio | Medio |
| Si falla mover un proyecto, "Deshacer" queda activo igual y al usarlo corre el proyecto en sentido contrario (DesgloceEngagements.tsx:1708-1731, 1843-1858) | Registrar el deshacer solo si el guardado salió bien | Medio |
| En "Vista Perfil Individual", las flechas avanzan 9 semanas (u 8 meses) pero solo se muestran 5 (o 4). Hay periodos que nunca se pueden ver (TableroClient.tsx:62-71) | Igualar el salto de las flechas a las columnas que se muestran | Medio |
| El botón dice "Confirmar asignación" pero la persona queda "Por confirmar" (DesgloceEngagements.tsx:3497-3502) | Corregir el texto o agregar un botón que confirme de verdad | Medio |
| "Eliminar requerimiento" borra todos los cupos del grupo de cargo y elimina por completo las asignaciones, también las históricas. El mensaje solo dice "desvincular" (DesgloceEngagements.tsx:788-817, 3224) | Borrar solo el cupo elegido y cerrar las asignaciones en vez de eliminarlas | Medio |
| Si falla asignar al soltar a una persona sobre el título, igual queda un cupo vacío, y "Deshacer" no lo borra (DesgloceEngagements.tsx:1236-1258, 567-569) | Borrar ese cupo si la asignación falla y también al deshacer | Medio |
| "Sí, eliminar" (requerimiento) permite doble clic (DesgloceEngagements.tsx:3219-3226) | Bloquear el botón mientras se borra | Bajo |
| "Confirmar Proyecto Real" y "Mover a Posible" se aplican sin preguntar. Al pasar a Posible, la ocupación del equipo cae a 0% (DesgloceEngagements.tsx:2292-2306) | Pedir confirmación | Bajo |
| Si falla guardar el color de una semana, en pantalla queda el color nuevo igual (DesgloceEngagements.tsx:1892-1910) | Volver al color anterior | Bajo |
| Al soltar a una persona sobre el título, las fechas del cupo cambian antes de revisar sus ausencias (DesgloceEngagements.tsx:1229-1234, 1269-1276) | Actualizar el cupo después de crear la asignación | Bajo |
| El rango de fechas del encabezado anuncia un mes o un día de más (TableroClient.tsx:55-60) | Calcularlo con la última columna que se ve | Bajo |

## Proyectos
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| Después de usar "Extender Proyecto", el formulario de edición ya no deja guardar. El error de fecha queda escondido en "Equipo del proyecto", que viene cerrado, así que al apretar "Guardar" no pasa nada visible (EngagementForm.tsx:560-577, 125, 1299; ExtenderProyecto.tsx:343-374) | Usar como límite la fecha fin más la extensión; si hay errores, abrir la sección y mostrar un aviso arriba | Alto |
| En "Editar proyecto", si varias personas comparten un requerimiento solo aparece una. Si se borra esa tarjeta, se eliminan las asignaciones de todas (EngagementForm.tsx:213-222, 637) | Mostrar cada asignación y borrar solo la de esa persona | Alto |
| Apagar "¿Quieres extender el proyecto?" y guardar borra el alargue y todas sus asignaciones sin confirmar (EngagementForm.tsx:926-929) | Pedir confirmación, igual que en Extender Proyecto | Alto |
| "Finalizar/Archivar Proyecto" archiva con un clic, sin preguntar (EngagementDetail.tsx:481-486, 299-308) | Agregar confirmación | Medio |
| Al cambiar las fechas del alargue, las personas asignadas a ese periodo quedan con las fechas viejas (EngagementForm.tsx:911-916) | Mover también las asignaciones ligadas al alargue | Medio |
| Guardar un alargue dentro de la edición cierra el formulario y se pierden los cambios sin guardar (EngagementForm.tsx:1678; EngagementDetail.tsx:792) | Solo recargar los datos, sin cerrar | Medio |
| Al reactivar un proyecto desde "Archivo Histórico", el equipo no se extiende a la nueva fecha (EngagementsList.tsx:565-566) | Extender también el equipo (sincronizarFechasEquipoEngagement) | Medio |
| El modal de colaborador reemplaza todos los tramos de la persona con un solo %, estado y cargo, y puede borrar tramos de otros requerimientos (ColaboradorModal.tsx:98-104, 225-249) | Reemplazar solo los tramos del mismo requerimiento y conservar el % de cada uno | Medio |
| En "Perfil" del modal de colaborador, la ocupación suma asignaciones ya terminadas y puede pasar de 100% (ColaboradorModal.tsx:125, 139, 415-420) | Sumar solo las asignaciones vigentes hoy | Medio |
| El % de dedicación acepta 0, negativos o más de 100 (EngagementForm.tsx:563-565) | Validar entre 1 y 100 | Medio |
| Una "Propuesta comercial" se puede guardar sin nombre y luego no se puede abrir desde la lista (EngagementForm.tsx:552-555) | Exigir nombre siempre | Medio |
| "Proposer" ve la Papelera y "Restaurar", pero la base no se lo permite y no aparece ningún aviso (EngagementsList.tsx:679, 617, 531) | Mostrar la Papelera solo a quienes pueden editar | Bajo |
| El ícono de alerta del detalle no explica qué falta y se muestra a roles que no deberían verlo (EngagementDetail.tsx:469) | Ocultarlo para los mismos roles que en la lista | Bajo |
| El "Tipo" se muestra con el nombre interno ("Posibles_proyectos") y "Fin estimado" no aparece si solo hay fecha real (EngagementDetail.tsx:516, 526-533) | Mostrar nombres legibles y usar la fecha real como respaldo | Bajo |

## Personas
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| Al eliminar una evaluación EPP/EDD, una evaluación de la matriz o un hito de remuneración, la tarjeta sigue en pantalla hasta recargar, y si falla no hay aviso (PersonaEvaluacionesTimeline.tsx:227-231; PersonaMatrizTimeline.tsx:224-228; PersonaRemuneracionesTimeline.tsx:114-118) | Revisar el error y quitar la tarjeta de la lista | Alto |
| Los "periodos de cargo" no se limpian al cerrar el formulario: la siguiente "Nueva persona" hereda los de la anterior y se guardan (PersonaForm.tsx:116-117) | Vaciar los periodos al abrir y al cerrar | Alto |
| Las Industrias y Temáticas editadas en el formulario no se reflejan en el perfil, y al abrirlo vuelve a agregar las que se quitaron a mano (PersonaProfile.tsx:222-227, 575-611) | Definir una sola fuente de datos (lo guardado en la persona más lo que viene de los proyectos) | Alto |
| La etiqueta de la Matriz de Talento (en el perfil y en Reportes) lee campos antiguos que nadie actualiza (PersonaMatrizTimeline.tsx:215-217; PersonaProfile.tsx:286) | Calcularla desde el último hito | Medio |
| "X% ocupado actualmente" suma asignaciones de proyectos ya terminados (PersonaProfile.tsx:165-171) | Filtrar por las fechas de hoy | Medio |
| Al crear una persona, si falla el guardado del historial, al reintentar se duplica la persona o falla por email repetido (PersonaForm.tsx:216-247) | Pasar a modo edición apenas se crea la ficha | Medio |
| Un periodo de carrera sin fecha de inicio se descarta sin aviso. Tampoco se valida el orden de las fechas ni que haya un solo cargo actual (PersonaForm.tsx:232, 492-501) | Validar antes de guardar | Medio |
| Si al editar falla la carga del historial o las industrias, al guardar se borran de la base (PersonaForm.tsx:122-139, 234-246) | Mostrar un aviso y bloquear "Guardar" | Medio |
| En Ex-Housers, quien se marca como Ex-Houser o se restaura después no aparece al buscar (PersonasList.tsx:235-239, 270-317) | Recargar la lista después de cada cambio | Medio |
| Al editar o eliminar una mentoría, la ficha se cambia aunque falle el guardado de la mentoría. Eliminar permite doble clic (MentoresMenteesSection.tsx:198-222) | Encadenar las actualizaciones y bloquear el botón | Medio |
| Al restaurar a un Ex-Houser desde la papelera como activo, conserva su fecha de salida y el hito "Ex-Houser" (PersonasList.tsx:336-345) | Reutilizar la limpieza de reactivarExHouser | Medio |
| En el Notebook, borrar una carpeta con subcarpetas avisa "0 notas" y mueve las notas sin preguntar (NotebookPanel.tsx:669, 682, 736) | Contar también las notas de las subcarpetas | Bajo |
| En el Notebook, si se cierra la pestaña antes de 1,5 s, lo último escrito puede perderse (NotebookPanel.tsx:171-175) | Avisar "¿Salir sin guardar?" | Bajo |
| "Tiempo en la empresa" cuenta hasta hoy también para Ex-Housers y es poco preciso (PersonaProfile.tsx:79-91) | Usar la fecha de salida y calcular con intervalToDuration | Bajo |
| Remuneraciones acepta montos negativos (PersonaRemuneracionesTimeline.tsx:97-100) | Validar que el monto sea mayor que 0 | Bajo |
| "Finalizar actual" de la mentoría usa una fecha que quedó escrita antes, no la de hoy (MentoresMenteesSection.tsx:83, 145, 251) | Usar hoy o pedir la fecha | Bajo |
| Si falla la carga de la lista, aparece "0 personas activas" sin aviso (PersonasList.tsx:165-176) | Mostrar el error | Bajo |
| El contador de Ex-Housers no baja al mandar a uno a la papelera (PersonasList.tsx:329-333) | Restar 1 al contador | Bajo |
| Un email duplicado muestra el mensaje técnico "duplicate key…" (PersonaForm.tsx:214, 223) | Mostrar "Ya existe una persona con ese email" | Bajo |
| La fecha de salida de "Desactivar persona" queda con la de la persona anterior (PersonasList.tsx:740) | Reiniciarla a hoy | Bajo |

## Ausencias
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| "🗑️ Eliminar tipo" borra para todo el equipo sin confirmar. Si se vuelve a crear, el código interno pierde los acentos ("Día" queda "da") y el Resumen de vacaciones deja de contarlo (HeatmapAusencias.tsx:330-343, 479; HeatmapAusenciasSemana.tsx:153-158; useTiposAusencia.ts:52, 70-80) | Confirmar antes de borrar, proteger los tipos base y conservar las letras con acento | Alto |
| En la vista Mes, las flechas o "Hoy" en un día 29, 30 o 31 saltan un mes (un 31-oct, "siguiente" lleva a diciembre) (AusenciasClient.tsx:155, 166, 176) | Moverse siempre desde el día 1 del mes | Medio |
| Un tipo creado o borrado no actualiza la leyenda ni los colores hasta recargar (AusenciasClient.tsx:66-68; HeatmapAusencias.tsx:647, 895-901) | Usar una lista de tipos compartida y recargarla | Medio |
| "X días ya tomados" suma todos los tipos, pero el Resumen vacaciones suma solo 4, así que la misma persona tiene dos totales (HeatmapAusencias.tsx:716-751 vs ResumenVacaciones.tsx:49, 219) | Usar el mismo criterio o aclarar el texto | Medio |
| La vista Trimestre muestra los % por grupo y la insignia "A" a roles que en Mes y Semana no los ven (HeatmapTrimestral.tsx:387, 463-483) | Aplicar las mismas reglas por rol | Medio |
| Desde Semana, el tipo inicial es "Vacaciones confirmadas"; desde Mes es "por confirmar" (HeatmapAusenciasSemana.tsx:123) | Usar "por confirmar" en ambas | Medio |
| Si falla la carga del Resumen vacaciones, aparecen todos con 0 días (ResumenVacaciones.tsx:45-55) | Mostrar el error | Medio |
| Si falla la tarjeta de una persona, aparece "Total 0" y "Sin ausencias" (ausencias.ts:388-390; PopoverPersona.tsx:74) | Mostrar "No se pudo cargar" | Bajo |
| En Semana, si falla la carga del segundo mes, esos días quedan vacíos sin aviso (HeatmapAusenciasSemana.tsx:396) | Avisar el error | Bajo |
| Se puede guardar una ausencia solo de fin de semana o feriado, que después no se ve en ninguna vista (HeatmapAusencias.tsx:364-376) | Avisar o impedir | Bajo |
| En Semana, los viajes no se pueden abrir ni eliminar (HeatmapAusenciasSemana.tsx:656-660) | Agregar el mismo detalle que en Mes | Bajo |
| El promedio del Trimestre cuenta los feriados como días normales y no junta las ausencias separadas solo por un fin de semana (HeatmapTrimestral.tsx:140, 464-468) | Excluir feriados y unir esos tramos | Bajo |
| Desarrollo puede abrir la tarjeta de una persona en Mes, pero no en Semana ni en Trimestre (HeatmapAusencias.tsx:648, 1108) | Usar la misma regla en las tres vistas | Bajo |

## Alertas
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| El basurero del "Historial gestionadas" borra la marca de "revisada" para todo el equipo, sin confirmar, y la alerta vuelve a quedar pendiente (AlertasPanel.tsx:776-780, 1090) | Pedir confirmación y explicarlo, o solo ocultarla del historial | Medio |
| "Terminados esta semana" cuenta un día de más: "Terminó hoy" nunca aparece (AlertasPanel.tsx:128-130, 595) | Calcular desde el inicio del día | Medio |
| Un doble clic en "marcar como gestionado" muestra un error rojo que no se borra (AlertasPanel.tsx:761-774, 834-836) | Bloquear el botón mientras guarda y limpiar el error | Medio |
| El número rojo del sidebar no coincide con lo que muestra la pestaña: incluye la papelera, los posibles proyectos y las alertas ya revisadas (Sidebar.tsx:105, 122-125) | Usar los mismos filtros que la pestaña | Bajo |
| Las marcas de "revisada" no llevan fecha: si la situación se repite, la alerta nueva nace oculta (AlertasPanel.tsx:750, 755) | Agregar la fecha a la marca | Bajo |
| Si falla una consulta, "20 días hábiles cumplidos" queda vacía sin aviso (AlertasPanel.tsx:652-657) | Mostrar el error | Bajo |

## Anotaciones
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| El Excel "Info personas" (Reportes > Descargables) incluye **todas** las anotaciones, también las **privadas** y las de la papelera, y lo puede descargar el rol admin (api/reportes/personas-resguardo-excel/route.ts:16, 21-25; excel-resguardo-personas.ts:125-127) | Excluir las privadas y las borradas, y permitir esa hoja solo al rol personas | Alto |
| Si se cierra o recarga la pestaña en el segundo y medio después de escribir, lo último se pierde (AnotacionEditor.tsx:96-99; anotaciones.ts:82) | Pasar el nombre del usuario sin consultarlo cada vez y avisar "¿Salir sin guardar?" | Medio |
| Si falla la carga, aparece "Aún no hay anotaciones", como si se hubiera borrado todo (anotaciones.ts:12, 143; AnotacionesList.tsx:308-309) | Mostrar "No se pudieron cargar las notas" | Medio |
| En el Excel, el contenido de las notas sale con código (`<p>`, `<strong>`) (excel-resguardo-personas.ts:139) | Convertirlo a texto plano con htmlToText | Medio |
| Al mandar una carpeta a la papelera, sus notas quedan sueltas y muestran "Sin carpeta" sin explicación (AnotacionesList.tsx:131-134) | Aclararlo en el mensaje o mandarlas también a la papelera | Bajo |
| El basurero de una nota no pide confirmación (AnotacionCard.tsx:27-38) | Confirmar o agregar "Deshacer" | Bajo |
| La papelera y la limpieza automática a los 15 días no avisan si fallan (anotaciones.ts:126-129) | Avisar el error | Bajo |

## Reportes
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| En "Resumen de Proyectos" **ninguna celda se puede editar, para ningún rol**: el permiso nunca se activa (ResumenProyectosClient.tsx:279, 540, 544) | Leer el rol al cargar y activar la edición para admin, personas y planificador | Alto |
| Si una persona está asignada con un cargo distinto al que pide el proyecto, no aparece y la celda muestra "?" (ResumenProyectosClient.tsx:127-162) | Agregar una línea "Otros" con esas asignaciones | Medio |
| El botón "Descargar Excel" se muestra a todos, pero solo admin, personas y planificador pueden descargar (ResumenProyectosClient.tsx:489-496) | Ocultarlo a los demás roles | Medio |
| Al escribir una inicial que no existe, la celda queda abierta con el error y no se explica cómo cerrarla (CeldaAsignacionEditable.tsx:146-151) | Mostrar "Cancelar" o "Esc para cancelar" | Bajo |
| "AB + AB" crea dos asignaciones iguales (CeldaAsignacionEditable.tsx:143-144) | Quitar los repetidos antes de guardar | Bajo |
| "N proyectos activos" incluye proyectos terminados y tipos que no se muestran (ResumenProyectosClient.tsx:338, 481) | Contar solo lo que se muestra | Bajo |
| En "Capacity de Proyectos" aparecen números como 2.3000000000000003 (CapacityProyectosClient.tsx:434, 548, 607) | Redondear con round2 | Bajo |
| En el Excel "Info personas", las notas creadas de noche quedan con la fecha del día siguiente (UTC) (excel-resguardo-personas.ts:135) | Usar la hora de Chile | Bajo |
| En el Excel del Resumen, un proyecto que empieza el 1 de enero queda en el año anterior (excel-sync.ts:474-475) | Tomar el año del texto de la fecha | Bajo |

## Planificación
*Hoy la sección está apagada (planificacion/page.tsx:11-23). Estos fallos no afectan a nadie todavía, pero hay que corregirlos **antes** de activarla.*
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| Aprobar un escenario borra **todas** las asignaciones activas de la empresa y solo recrea las de los próximos 90 días (GanttPlanificacion.tsx:208, 216-223, 944-948) | Reemplazar solo lo que cubre el escenario, en una función atómica | Alto |
| Aprobar marca "terminado" cualquier proyecto activo que no esté en el escenario, incluso los creados después (GanttPlanificacion.tsx:921-941) | Cerrar solo los proyectos quitados a propósito | Alto |
| La aprobación tiene muchos pasos separados: si uno falla, el Tablero queda a medias (GanttPlanificacion.tsx:944-975) | Hacer todo en una transacción | Alto |
| "Deshacer aprobación" restaura una copia vieja y pierde todo lo que se cambió después (GanttPlanificacion.tsx:1101-1118) | Restaurar solo lo que cambió esa aprobación, o bloquear si hubo cambios posteriores | Alto |
| Las actividades (viajes y talleres) se borran y se reinsertan, y si la inserción falla, se pierden (GanttPlanificacion.tsx:1015-1036) | Detener la aprobación ante el error | Alto |
| "Guardar escenario" dice "guardado" aunque la base lo rechace (GanttPlanificacion.tsx:182, 768-772) | Revisar el error | Medio |
| La copia local del navegador tiene prioridad sobre la base de datos (GanttPlanificacion.tsx:148-150) | Usar la base como fuente de verdad | Medio |
| Eliminar un escenario lo quita de la pantalla aunque falle, y reaparece al recargar (GanttPlanificacion.tsx:199, 1248-1254) | Revisar el error antes de quitarlo | Medio |
| El autor del escenario no se muestra: se pide la columna "cargo", que no existe (es cargo_actual) (GanttPlanificacion.tsx:128, 329) | Usar cargo_actual | Bajo |
| El aviso promete un borrado automático a los 30 días que no existe (GanttPlanificacion.tsx:1270) | Crear la limpieza o cambiar el texto | Bajo |
| Borrar una nota de un escenario no confirma ni revisa errores, y las notas quedan sueltas al eliminar el escenario (AnotacionesDrawer.tsx:124-127) | Confirmar, revisar el error y borrarlas junto con el escenario | Bajo |

## Capacity
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| En "Actualizar capacidad" y "Set Capacity", un valor vacío o inválido guarda 0 en todas las semanas elegidas (por defecto, todo el año) (CapacityGantt.tsx:80, 216) | Validar el número y no guardar si no es válido | Medio |
| El indicador mensual siempre busca el mes actual: en otros años muestra "0 proyectos" (CapacityClient.tsx:85-87) | Mostrar el promedio anual u ocultar el indicador | Medio |
| Si falla el cambio de año, se sigue viendo la grilla del año anterior (CapacityGantt.tsx:397-405) | Vaciar la grilla o volver al año anterior | Bajo |
| Al borrar una celda para escribir otro número, a los 0,8 s se guarda 0 (CapacityGantt.tsx:655-663) | No guardar si la celda está vacía | Bajo |
| Con todo en 0, igual aparece "Restringido por Gerencia" (CapacityClient.tsx:49-52) | Ocultar el aviso si todo es 0 | Bajo |

## Accesos
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| Si falla el envío del correo de invitación, el rol queda guardado pero la lista no se refresca, y al reintentar sale "ya tiene acceso" (lib/auth/actions.ts:198-214; AccesosManager.tsx:396-399) | Refrescar la lista y sugerir "Reenviar invitación" | Medio |
| El selector no tiene "Proposer": esas personas aparecen como "Admin" (AccesosManager.tsx:22-29, 234) | Agregar Proposer a la lista | Medio |
| El rol Planificador puede escribir en casi toda la base, aunque la app lo trata como solo lectura (migrations 20261027_acceso_activo_en_rls.sql:36-45) | Quitarle los permisos de escritura mientras Planificación esté apagada | Medio |
| Si falla el bloqueo al suspender, la persona sigue viéndose "Activo" (actions.ts:333-347, 407-423) | Refrescar la lista siempre | Bajo |
| Si falla la carga, aparece "Aún no hay personas con acceso" (AccesosManager.tsx:76-77) | Mostrar el error | Bajo |
| Los textos de ayuda describen mal los permisos de cada rol (AccesosManager.tsx:298-299, 464-466) | Corregir los textos | Bajo |

## Configuración
| Qué está pasando | Cómo se arregla | Impacto |
|---|---|---|
| El basurero desactiva una industria o temática sin confirmar. Los proyectos que la usaban muestran "Sin industria" al editarlos (CatalogoTab.tsx:68-77, 163; EngagementForm.tsx:182, 1029) | Confirmar indicando cuántos proyectos la usan, y mostrar la opción inactiva si ya está asignada | Medio |
| Los botones de editar y desactivar solo aparecen al pasar el mouse, así que no se ven en pantallas táctiles (CatalogoTab.tsx:158, 186) | Dejarlos siempre visibles | Bajo |
