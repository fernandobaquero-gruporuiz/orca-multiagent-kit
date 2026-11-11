# Olimpo: roles, modelos y worktrees en la orquestación

Este documento explica qué añade Olimpo a la skill `orca` y de dónde sale. Tiene dos partes: **cómo lo usa el kit** (lo que cambia en tu día a día) y **el equipo de origen** (las 24 fichas que inspiran los roles). Los agentes no leen este fichero: su versión operativa es `skills/orca/references/olimpo.md`.

## Cómo lo usa el kit

### Una sola cadena de decisión

```text
unidad ──► rol ──► nivel (alto | medio | bajo) ──► modelo del proveedor
           olimpo.md                               ~/.agents/models.md
```

| Quién decide | Qué decide | Dónde |
|---|---|---|
| El kit | Qué rol hace cada tipo de trabajo, qué nivel exige y quién lo revisa | `skills/orca/references/olimpo.md` |
| Tú, una vez por máquina | Qué modelo es cada nivel en cada proveedor | `~/.agents/models.md` |
| Cada proyecto | Proveedores activos, dominios sensibles y excepciones | `ORCHESTRATION.md` §1 |

Ningún fichero del kit ni del proyecto nombra un modelo, así que no hay nada que actualizar cuando sale uno nuevo.

### Niveles de modelo

| Nivel | Trabajo | Ejemplo con Claude |
|---|---|---|
| `alto` | Arquitectura estructural, seguridad, normativa, revisiones críticas y código de dinero, fiscal, tenancy y auth | `opus` |
| `medio` | Implementación general, ADR técnicos, investigación técnica, tests e infraestructura | `sonnet` |
| `bajo` | Tareas mecánicas: tableros, índices, plantillas, formateo, enlaces y extracción | `haiku` |

Claude usa alias, que apuntan solos al modelo vigente. Para un proveedor sin alias (Antigravity, con `agy models`), la skill consulta su lista de modelos al empezar cada run:

- Si la lista no ha cambiado, usa la asignación guardada sin preguntar.
- Si aparece una versión nueva de una familia que ya tiene nivel, entra sola.
- Si aparece una familia nueva, el coordinador la clasifica él mismo con evidencia (los alias de nivel y el changelog del proveedor, documentación pública) y comprueba que tu cuenta puede usarla. Te lo dice en una línea del plan de rondas; no te lo pregunta. Si no encuentra evidencia, la deja en `medio`.
- Si desaparece el modelo de un nivel, avisa y lanza esas unidades con el modelo por defecto del proveedor. Las de nivel `alto` van a otro proveedor.

### De las 24 fichas a los roles

Doce fichas son roles de agente. Cinco se funden en otro rol porque el trabajo es el mismo. Siete no son agentes: representan decisiones que te corresponden a ti.

| Destino | Fichas |
|---|---|
| Rol propio | Hefesto (coordinación), Dédalo (arquitectura), Casandra (seguridad), Temis (normativa), Ariadna (código sensible), Perséfone (datos), Proteo (implementación), Narciso (interfaz), Ícaro (integraciones), Argos (verificación), Atlas (plataforma), Clío (mecánico) |
| Fundida en otro rol | Iris y Afrodita → Narciso · Prometeo → Atlas · Mnemósine → Perséfone · Penélope → Clío |
| Decisión del usuario | Atenea, Hermes, Apolo, Hestia, Odiseo, Asclepio, Néstor |

Las carencias de cada ficha no se interpretan: se convierten en un guardarraíl. Ícaro va deprisa y se salta casos límite, así que nunca toca código sensible y Argos repite su verificación. A Casandra se la ignora, así que sus hallazgos altos bloquean el merge. Hefesto acapara lo difícil, así que el coordinador está obligado a delegar las unidades medianas.

Si tu proyecto necesita un rol que el kit no trae (por ejemplo, separar a Iris de Narciso, o una Temis con la normativa fiscal concreta), añádelo en `ORCHESTRATION.md` §1.

### Qué recurso usa cada unidad

El recurso se decide unidad a unidad, y un run puede mezclar varios.

| La unidad… | Recurso |
|---|---|
| Es pequeña o es la única | El propio coordinador |
| No escribe (investigar, auditar, revisar) | Subagente de solo lectura, sin worktree |
| La hace otro proveedor o es una revisión cruzada | Worker de Orca, con worktree propio |
| Escribe y la hace el mismo proveedor que coordina | Subagente con worktree propio |
| No hay Orca ni subagentes | Worktree a mano y un brief para que abras tú el agente |

El plan de rondas enseña el rol, el nivel, el modelo y el recurso de cada unidad antes de que digas «sí».

### Proyectos que ya tenías inicializados

No hay que reinicializarlos. Si a su `ORCHESTRATION.md` le faltan los datos nuevos (proveedores activos, dominios sensibles, setup de worktree) o su `.worktreeinclude` no lista el `.env` que la app necesita, la skill lo deduce al empezar el run, lo usa y te lo dice en una línea del plan. Al cerrar el run te ofrece una vez guardarlo en los ficheros del proyecto.

### Ciclo de vida de un worktree

1. **Base fresca.** Antes de planificar, `git fetch` y comparación de la rama padre con `origin`. Si la local va por detrás, se parte de `origin`; si tiene commits sin subir, se te pregunta. La comprobación se repite antes del merge final.
2. **Entorno listo.** Cada worktree recibe sus dependencias y los `.env` de desarrollo de `.worktreeinclude`. El worker comprueba que el entorno arranca antes de editar; si no, se para con `BLOCKED: entorno`.
3. **Limpieza con permiso.** Tras el merge final, el coordinador enseña qué worktrees, ramas y copias de `.env` han quedado, y los borra solo con tu «sí». Lo que no está integrado o tiene cambios sin guardar no entra en ese «sí». Si dices que no, lo recuerda en el siguiente run.

## El equipo de origen: Olimpia Software

Lo que sigue es el documento original del equipo, sin cambios. Es un equipo ficticio de un ERP; sus nombres, relaciones y tensiones son la fuente de los roles y guardarraíles de arriba.

## La empresa y el equipo

Olimpia Software es una empresa ficticia de 140 empleados que desarrolla **Égida**, un ERP en la nube para pymes: facturación, contabilidad, inventario, RRHH y CRM. Este documento recoge a 24 personas: la dirección de producto y tecnología, el equipo de producto de Facturación y Contabilidad al completo, y los perfiles transversales que trabajan con él.

Todos los nombres vienen de la mitología griega y no son casuales: cada ficha explica por qué le pega.

| Nombre | Rol | Grupo | Reporta a |
| --- | --- | --- | --- |
| Atenea | CTO | Dirección | CEO |
| Hermes | Head of Product | Dirección | CEO |
| Apolo | Head of Design | Dirección | Hermes |
| Hestia | Engineering Manager | Facturación | Atenea |
| Odiseo | Product Manager | Facturación | Hermes |
| Afrodita | Diseñadora UX/UI | Facturación | Apolo |
| Hefesto | Tech Lead | Facturación | Hestia |
| Ariadna | Backend senior | Facturación | Hestia |
| Perséfone | Backend | Facturación | Hestia |
| Ícaro | Backend junior | Facturación | Hestia |
| Narciso | Frontend senior | Facturación | Hestia |
| Iris | Frontend | Facturación | Hestia |
| Proteo | Full-stack | Facturación | Hestia |
| Argos | QA / SDET | Facturación | Hestia |
| Dédalo | Principal Engineer / Arquitecto | Transversal | Atenea |
| Atlas | SRE | Plataforma | Atenea |
| Prometeo | Ingeniero de plataforma / DevOps | Plataforma | Atenea |
| Casandra | Ingeniera de seguridad | Transversal | Atenea |
| Mnemósine | Ingeniera de datos | Transversal | Atenea |
| Temis | Experta de dominio fiscal y legal | Transversal | Hermes |
| Penélope | Agile Coach / Delivery Manager | Transversal | Atenea |
| Clío | Redactora técnica | Transversal | Hermes |
| Asclepio | Soporte técnico nivel 3 | Soporte | Director de Soporte |
| Néstor | Customer Success Manager | Negocio | Director Comercial |

## Dirección

### Atenea · CTO

- **Edad y antigüedad:** 47 años, en Olimpia desde la fundación (9 años).
- **Trayectoria:** Ingeniera informática. Doce años en una gran consultora haciendo implantaciones de SAP, harta de ver ERP imposibles de usar. Cofundó la empresa y escribió la primera versión de Égida casi sola.
- **Fortalezas:** Visión estratégica clara y calmada. Sabe traducir decisiones técnicas a lenguaje de negocio delante del consejo. Contrata muy bien.
- **Carencias:** Le cuesta soltar el producto que creó: a veces entra en decisiones técnicas de detalle que ya no le tocan. Poco paciente con quien no prepara las reuniones.
- **Fuera de su ámbito:** Entiende las finanzas de la empresa casi como el director financiero. Es una negociadora excelente con proveedores de nube.
- **Cómo trabaja:** Agenda bloqueada por las mañanas para pensar. Decide con documentos escritos, no con presentaciones.
- **Relaciones:** Confianza total en Dédalo, que fue su primer fichaje. Discute a menudo con Hermes sobre prioridades, pero se respetan.
- **Por qué Atenea:** Diosa de la sabiduría y la estrategia. Nació ya armada de la cabeza de Zeus, como Égida nació de la suya.

### Hermes · Head of Product

- **Edad y antigüedad:** 39 años, 5 años en la empresa.
- **Trayectoria:** Empezó en ventas de software B2B, pasó a gestión de producto en una fintech y llegó a Olimpia como primer PM. Ahora dirige a cinco product managers.
- **Fortalezas:** Comunicador brillante: convence a clientes, inversores y equipos. Conoce el mercado y a la competencia al detalle.
- **Carencias:** Promete fechas antes de consultarlas con ingeniería. Cambia de prioridad demasiado rápido cuando un cliente grande presiona.
- **Fuera de su ámbito:** Cierra ventas mejor que muchos comerciales; el equipo comercial le llama para las demos difíciles. Habla inglés, francés y portugués.
- **Cómo trabaja:** Siempre en movimiento, entre reuniones y viajes. Responde mensajes a cualquier hora, lo que genera expectativas poco sanas.
- **Relaciones:** Mentor de Odiseo. Tensión habitual con Atenea y Hestia por los compromisos de fechas.
- **Por qué Hermes:** Mensajero de los dioses y patrón del comercio. También de los que hablan rápido.

### Apolo · Head of Design

- **Edad y antigüedad:** 42 años, 4 años en la empresa.
- **Trayectoria:** Bellas Artes y después diseño de interacción. Trabajó en agencias y en una empresa de software de gestión hospitalaria. Creó el sistema de diseño de Égida desde cero.
- **Fortalezas:** Criterio estético impecable y defensa firme de la investigación con usuarios. Ha subido el nivel de diseño de toda la empresa.
- **Carencias:** Algo elitista: le cuesta aceptar diseños “suficientemente buenos”. Poco interesado en las métricas de negocio.
- **Fuera de su ámbito:** Escribe muy bien y da charlas en conferencias; es la cara pública de la empresa en eventos de diseño. Toca el piano.
- **Cómo trabaja:** Revisiones de diseño semanales muy exigentes y muy formativas.
- **Relaciones:** Protector con Afrodita, a quien contrató. Choca con Narciso, que cree saber de diseño tanto como él.
- **Por qué Apolo:** Dios de las artes, la armonía y la belleza ordenada.

## Equipo de Facturación y Contabilidad

Es el equipo más crítico de Égida: si una factura sale mal, el cliente tiene un problema con Hacienda. Once personas, todas a tiempo completo en este dominio.

### Hestia · Engineering Manager

- **Edad y antigüedad:** 41 años, 6 años en la empresa.
- **Trayectoria:** Ocho años como desarrolladora backend, los tres últimos aquí. Pasó a gestión cuando el equipo creció y nadie quería el puesto.
- **Fortalezas:** Escucha de verdad y detecta antes que nadie a quien está quemado. Protege al equipo de interrupciones de dirección. Muy buena contratando.
- **Carencias:** Suaviza tanto el feedback negativo que a veces no llega. Lleva tres años sin programar y sus estimaciones se han vuelto optimistas.
- **Fuera de su ámbito:** Mediadora natural; otros managers le piden ayuda con conflictos. Organiza las cenas y nunca olvida un cumpleaños.
- **Cómo trabaja:** Reuniones 1:1 semanales sagradas. Prefiere resolver en persona antes que por mensaje.
- **Relaciones:** Alianza fuerte con Penélope. Le preocupa la dependencia del equipo de Hefesto.
- **Por qué Hestia:** Diosa del hogar y del fuego que lo mantiene vivo. Cuida la casa y no busca protagonismo.

### Odiseo · Product Manager

- **Edad y antigüedad:** 35 años, 3 años en la empresa.
- **Trayectoria:** Consultoría de procesos financieros y luego analista de negocio. Hermes lo fichó y lo formó como PM.
- **Fortalezas:** Ingenioso para encontrar soluciones intermedias que contentan a todos. Habla con clientes cada semana y trae datos reales. Sabe decir no a ventas sin crear enemigos.
- **Carencias:** Se enamora de las ideas grandes y escribe historias de usuario vagas que hay que perseguir para concretar. Sus planes suelen tardar el doble de lo previsto.
- **Fuera de su ámbito:** Maneja Excel y SQL mejor que algunos desarrolladores. Presenta de maravilla delante de dirección.
- **Cómo trabaja:** Documentos de producto largos y narrativos. Muchas llamadas con clientes, pocas reuniones internas.
- **Relaciones:** Tándem estrecho con Temis. Afrodita le pide más tiempo para investigar y él no siempre se lo da.
- **Por qué Odiseo:** El astuto, el de las mil tretas. Y sus viajes siempre duran más de lo planeado.

### Afrodita · Diseñadora UX/UI

- **Edad y antigüedad:** 29 años, 2 años en la empresa.
- **Trayectoria:** Grado en Diseño y máster en UX. Trabajó en una app de banca móvil antes de llegar aquí.
- **Fortalezas:** Obsesionada con la eficiencia: rediseñó la creación de facturas y redujo los clics a la mitad. Prueba con usuarios reales, no con suposiciones. Interfaces que la gente disfruta usando.
- **Carencias:** Diseña cosas técnicamente carísimas sin consultar antes, y le frustra cuando se recortan. Le cuesta aceptar críticas en público.
- **Fuera de su ámbito:** Sabe HTML y CSS y a veces corrige detalles visuales en el código. Escribe muy bien: los textos de la interfaz son suyos.
- **Cómo trabaja:** Prototipos rápidos en Figma, muchas iteraciones, entrevistas grabadas con usuarios.
- **Relaciones:** Buena sintonía con Iris. Choques frecuentes con Narciso por los detalles visuales.
- **Por qué Afrodita:** Diosa de la belleza y del deseo: hace que la gente quiera usar un software de contabilidad.

### Hefesto · Tech Lead

- **Edad y antigüedad:** 38 años, 7 años en la empresa.
- **Trayectoria:** FP de Informática, autodidacta en todo lo demás. Lleva aquí desde la primera versión del módulo de facturación.
- **Fortalezas:** Conoce el sistema entero, incluido el código heredado que nadie quiere tocar. Sus revisiones de código son exigentes pero enseñan. Construye cosas que duran.
- **Carencias:** Acapara las tareas difíciles porque las hace más rápido, lo que frena a los demás. Mal delegador. Poco hábil en reuniones con dirección.
- **Fuera de su ámbito:** Entiende de infraestructura mejor que algunos de plataforma; Atlas le consulta. Toca la batería en un grupo los fines de semana.
- **Cómo trabaja:** Silencioso, con cascos, horas de concentración. Responde tarde a los mensajes pero bien.
- **Relaciones:** Mentor de Ícaro y Ariadna. Discusiones técnicas largas con Dédalo.
- **Por qué Hefesto:** El herrero de los dioses, que forjaba en su taller las armas del Olimpo. Poco dado a los banquetes.

### Ariadna · Desarrolladora backend senior

- **Edad y antigüedad:** 33 años, 4 años en la empresa.
- **Trayectoria:** Estudió ADE, trabajó dos años en una gestoría y se pasó a la programación con un máster.
- **Fortalezas:** La más rigurosa con los cálculos: redondeos, impuestos, divisas. Sus tests cubren casos que nadie imagina. Capaz de seguir el hilo de cualquier error hasta su origen.
- **Carencias:** Perfeccionista: le cuesta dar algo por terminado y a veces sobrediseña. Poco visible; no vende su trabajo.
- **Fuera de su ámbito:** Entiende la contabilidad casi como Temis. Redacta la mejor documentación técnica del equipo.
- **Cómo trabaja:** Metódica, con notas detalladas de cada investigación. Pide tiempo para hacer las cosas bien.
- **Relaciones:** Candidata natural a Tech Lead si Hefesto se va, aunque ella no lo busca. Paciente con Ícaro.
- **Por qué Ariadna:** Le dio a Teseo el hilo para salir del laberinto. Ella encuentra la salida de cualquier bug.

### Perséfone · Desarrolladora backend

- **Edad y antigüedad:** 31 años, 3 años en la empresa.
- **Trayectoria:** Ingeniería informática. Antes trabajó en una empresa de logística manteniendo sistemas antiguos.
- **Fortalezas:** Especialista en migraciones y en el código legado. Paciencia infinita con sistemas viejos. Fiable con los procesos de cierre contable.
- **Carencias:** Poco entusiasta con tecnologías nuevas. Divide su energía: muy productiva en temporadas y apagada en otras.
- **Fuera de su ámbito:** Gran conocimiento de bases de datos; hace las veces de DBA del equipo. Cultiva un huerto y reparte tomates en verano.
- **Cómo trabaja:** Prefiere tareas largas y profundas a muchas pequeñas.
- **Relaciones:** Colabora mucho con Mnemósine. Se lleva bien con todos sin ser el centro de nada.
- **Por qué Perséfone:** Reina del inframundo la mitad del año: ella vive en las profundidades del código antiguo, y su ritmo va por estaciones.

### Ícaro · Desarrollador backend junior

- **Edad y antigüedad:** 24 años, 1 año en la empresa.
- **Trayectoria:** Ciclo de DAW y un año en una startup que cerró. Muchos proyectos personales.
- **Fortalezas:** Rapidísimo y con ganas de todo. Siempre se ofrece para las integraciones con bancos y APIs externas. Automatiza tareas repetitivas con scripts.
- **Carencias:** Va tan deprisa que se salta casos límite. Subestima las tareas y se resiste a pedir ayuda. Ya ha provocado una incidencia en producción.
- **Fuera de su ámbito:** Sabe algo de frontend, móvil y despliegues. Es el que explica a los demás las novedades de herramientas de IA.
- **Cómo trabaja:** Muchos commits pequeños, a cualquier hora. Le aburren las reuniones.
- **Relaciones:** Tensión constante con Argos. Hefesto le corrige mucho y él lo vive como freno.
- **Por qué Ícaro:** Voló demasiado cerca del sol con alas de cera. El talento está; falta medir la altura.

### Narciso · Desarrollador frontend senior

- **Edad y antigüedad:** 36 años, 5 años en la empresa.
- **Trayectoria:** Ingeniería de telecomunicaciones, después frontend en un medio digital grande.
- **Fortalezas:** Experto en interfaces con muchos datos: tablas enormes, filtros, rendimiento. Muy cuidadoso con la accesibilidad. Código impecable.
- **Carencias:** Muy seguro de su criterio y poco abierto a otras opiniones. Desconfía de cada librería nueva. Le cuesta colaborar con diseño.
- **Fuera de su ámbito:** Fotógrafo aficionado con buen ojo visual; detecta fallos de diseño antes que la propia diseñadora, lo que genera tensión.
- **Cómo trabaja:** Revisa su propio código una y otra vez antes de enviarlo. Pocas entregas, todas pulidas.
- **Relaciones:** Mentor exigente de Iris. Fricciones con Afrodita y con Apolo.
- **Por qué Narciso:** Enamorado de su propio reflejo. En su caso, del de su código.

### Iris · Desarrolladora frontend

- **Edad y antigüedad:** 27 años, 2 años en la empresa.
- **Trayectoria:** Grado en Multimedia. Empezó como diseñadora web y se pasó al desarrollo.
- **Fortalezas:** Puente entre diseño y desarrollo: entiende a Afrodita y a Narciso. Domina el sistema de diseño y los componentes visuales. Muy colaboradora.
- **Carencias:** Insegura con la lógica compleja del frontend. Evita el conflicto aunque tenga razón.
- **Fuera de su ámbito:** Hace ilustraciones e iconos; varios de los de Égida son suyos. Muy buena con animaciones sutiles.
- **Cómo trabaja:** Pregunta mucho, comparte avances pronto, trabaja bien en pareja.
- **Relaciones:** Mediadora involuntaria entre Afrodita y Narciso.
- **Por qué Iris:** Diosa del arcoíris y mensajera entre el cielo y la tierra. Ella traduce entre diseño y código.

### Proteo · Desarrollador full-stack

- **Edad y antigüedad:** 30 años, 3 años en la empresa.
- **Trayectoria:** Ingeniería informática y cuatro años en consultoras saltando de proyecto en proyecto.
- **Fortalezas:** Cubre backend o frontend según haga falta. Entiende el problema de negocio antes de programar. Se adapta a cualquier tarea.
- **Carencias:** No destaca en nada concreto y a veces siente que no tiene especialidad. Se dispersa con demasiadas tareas a la vez.
- **Fuera de su ámbito:** Explica temas técnicos a gente no técnica mejor que nadie; Odiseo lo lleva a reuniones con clientes.
- **Cómo trabaja:** Coge lo que nadie coge. Suele tener tres tareas abiertas a la vez.
- **Relaciones:** Buen amigo de Ícaro, al que frena un poco. Todo el equipo le pide favores.
- **Por qué Proteo:** Dios marino que cambiaba de forma a voluntad.

### Argos · QA / SDET

- **Edad y antigüedad:** 32 años, 4 años en la empresa.
- **Trayectoria:** Empezó haciendo pruebas manuales en una empresa de videojuegos y aprendió a automatizar por su cuenta.
- **Fortalezas:** Montó la batería de tests automáticos que evita errores en las facturas. Piensa como un usuario despistado y encuentra fallos absurdos. Nada se le escapa.
- **Carencias:** Le cuesta priorizar: todo error le parece urgente. Puede bloquear entregas por detalles menores.
- **Fuera de su ámbito:** Programa bastante bien; podría pasar a desarrollo cuando quisiera. Mantiene la documentación de los flujos de negocio más al día que nadie.
- **Cómo trabaja:** Listas de comprobación para todo. Revisa cada pase a producción.
- **Relaciones:** Alianza con Ariadna y Casandra. Tensión permanente con Ícaro.
- **Por qué Argos:** El gigante de los cien ojos que nunca dormía del todo.

## Perfiles transversales

Trabajan con Facturación pero también con los otros cuatro equipos de producto, así que su tiempo siempre está en disputa.

### Dédalo · Principal Engineer / Arquitecto

- **Edad y antigüedad:** 50 años, 8 años en la empresa.
- **Trayectoria:** Treinta años programando: banca, telecomunicaciones y sistemas de reservas. Primer fichaje de Atenea.
- **Fortalezas:** Diseña arquitecturas elegantes que aguantan años. Visión de conjunto que nadie más tiene. Excelente mentor de seniors.
- **Carencias:** Sus diseños a veces son tan ingeniosos que solo él los entiende. Le cuesta aceptar soluciones pragmáticas “feas”.
- **Fuera de su ámbito:** Carpintero en sus ratos libres; construye muebles a mano. Gran conocedor de historia de la informática.
- **Cómo trabaja:** Escribe documentos de decisiones de arquitectura (ADR) para todo. Revisa los diseños de todos los equipos.
- **Relaciones:** Debates eternos con Hefesto. Protege a Ícaro más de lo que admite, quizá porque le recuerda a sí mismo de joven.
- **Por qué Dédalo:** El arquitecto del laberinto de Creta. Y padre de Ícaro.

### Atlas · SRE

- **Edad y antigüedad:** 34 años, 4 años en la empresa.
- **Trayectoria:** Administrador de sistemas en un proveedor de hosting y después SRE en un e-commerce con picos de tráfico brutales.
- **Fortalezas:** Mantiene el sistema estable en los cierres de mes y trimestre, cuando la carga se dispara. Muy calmado en las incidencias.
- **Carencias:** Reparte su tiempo entre cinco equipos y siempre va saturado. Responde tarde a lo que no es urgente. Cuesta que se tome vacaciones.
- **Fuera de su ámbito:** Sabe mucho de redes y de costes de nube; ha ahorrado a la empresa miles de euros al mes.
- **Cómo trabaja:** Paneles de monitorización siempre abiertos. Postmortems sin culpables tras cada incidencia.
- **Relaciones:** Hefesto es su apoyo informal. Equipo de dos con Prometeo.
- **Por qué Atlas:** Condenado a sostener el cielo sobre sus hombros. Él sostiene la plataforma.

### Prometeo · Ingeniero de plataforma / DevOps

- **Edad y antigüedad:** 29 años, 2 años en la empresa.
- **Trayectoria:** Desarrollador backend que se fue especializando en herramientas internas y automatización.
- **Fortalezas:** Crea herramientas que hacen más productivos a los demás: despliegues en minutos, entornos de prueba automáticos. Generoso con su conocimiento.
- **Carencias:** Cambia herramientas sin avisar con suficiente antelación. Algo rebelde con los procesos de aprobación.
- **Fuera de su ámbito:** Da talleres internos sobre productividad y herramientas. Muy activo en proyectos de código abierto.
- **Cómo trabaja:** Prueba primero, pide permiso después. Documenta todo en la wiki interna.
- **Relaciones:** Casandra le ha frenado más de un cambio arriesgado. Muy querido por los desarrolladores.
- **Por qué Prometeo:** Robó el fuego a los dioses para dárselo a los humanos. Él da herramientas a los equipos, a veces sin pedir permiso.

### Casandra · Ingeniera de seguridad

- **Edad y antigüedad:** 37 años, 3 años en la empresa.
- **Trayectoria:** Pentester en una consultora de ciberseguridad. Certificaciones OSCP y CISSP.
- **Fortalezas:** Detecta vulnerabilidades antes de que existan. Lleva el cumplimiento de RGPD e ISO 27001. Muy técnica.
- **Carencias:** Suena alarmista y la gente ha aprendido a ignorarla. Explica mal por qué algo importa en términos de negocio.
- **Fuera de su ámbito:** Sabe bastante de derecho digital. Escribe novelas de intriga que todavía no ha publicado.
- **Cómo trabaja:** Revisiones de seguridad en cada diseño importante. Formaciones trimestrales obligatorias que nadie quiere hacer.
- **Relaciones:** Argos es su gran aliado. Fricción con Prometeo y con Hermes, que ve la seguridad como freno.
- **Por qué Casandra:** Profetizó la caída de Troya y nadie la creyó. Siempre tenía razón.

### Mnemósine · Ingeniera de datos

- **Edad y antigüedad:** 35 años, 3 años en la empresa.
- **Trayectoria:** Matemáticas y estadística. Analista de datos en una aseguradora antes de pasar a ingeniería de datos.
- **Fortalezas:** Construyó el almacén de datos y los informes que ven los clientes. Recuerda dónde está cada dato y cómo ha cambiado. Muy fiable.
- **Carencias:** Poco comunicativa: nadie sabe en qué trabaja hasta que lo entrega. Le cuesta decir no a peticiones de informes.
- **Fuera de su ámbito:** Hace análisis de producto que deberían hacer los PM. Juega al ajedrez a nivel federado.
- **Cómo trabaja:** Trabajo largo y silencioso, entregas muy completas.
- **Relaciones:** Colabora mucho con Perséfone. Odiseo y Hermes dependen de sus datos.
- **Por qué Mnemósine:** Titánide de la memoria y madre de las musas. Guarda la memoria de la empresa.

### Temis · Experta de dominio fiscal y legal

- **Edad y antigüedad:** 52 años, 3 años en la empresa.
- **Trayectoria:** Veinte años como asesora fiscal y contable en un despacho propio. Lo vendió y se incorporó a Olimpia.
- **Fortalezas:** Traduce la normativa en requisitos claros. Anticipa cambios legales con meses de margen. Su palabra es ley en temas fiscales.
- **Carencias:** No entiende cómo funciona el desarrollo y pide cambios “pequeños” que suponen semanas. Le frustra el lenguaje técnico.
- **Fuera de su ámbito:** Red enorme de contactos en asesorías que sirve para probar funcionalidades con clientes reales. Excelente formadora.
- **Cómo trabaja:** Documentos de requisitos con referencias a la normativa. Revisa cada funcionalidad fiscal antes de salir.
- **Relaciones:** Tándem con Odiseo. Ariadna es la desarrolladora con quien mejor se entiende.
- **Por qué Temis:** Diosa de la ley y el orden justo, con su balanza.

### Penélope · Agile Coach / Delivery Manager

- **Edad y antigüedad:** 44 años, 5 años en la empresa.
- **Trayectoria:** Gestión de proyectos tradicional en una constructora, después Scrum Master y coach ágil.
- **Fortalezas:** Paciencia infinita. Hace visibles los bloqueos entre equipos y los desatasca. Retrospectivas que de verdad cambian cosas.
- **Carencias:** Rehace los procesos demasiado a menudo; el equipo se cansa de cambiar de método. Poco técnica.
- **Fuera de su ámbito:** Facilitadora de talleres excelente; dirección la usa para las reuniones estratégicas. Teje y hace ganchillo en las reuniones largas.
- **Cómo trabaja:** Tableros visuales, métricas de flujo, conversaciones uno a uno con cada miembro.
- **Relaciones:** Alianza con Hestia. Hermes es el que más le rompe los planes.
- **Por qué Penélope:** Tejía de día y destejía de noche, esperando con paciencia. Ella hace y deshace procesos.

### Clío · Redactora técnica

- **Edad y antigüedad:** 33 años, 2 años en la empresa.
- **Trayectoria:** Filología Hispánica, correctora editorial y después redactora de documentación de software.
- **Fortalezas:** Convierte funcionalidades complejas en guías claras. Mantiene las notas de versión y la documentación de la API. Excelente memoria de qué cambió y cuándo.
- **Carencias:** Se entera tarde de los cambios y persigue a los equipos para documentar. Poco asertiva para exigirlo.
- **Fuera de su ámbito:** Revisa los textos de la interfaz y los correos a clientes. Sabe algo de programación y lee código para entender lo que documenta.
- **Cómo trabaja:** Entrevistas cortas con desarrolladores; primeros borradores rápidos.
- **Relaciones:** Afrodita y Argos son sus mejores fuentes. Ariadna le pasa documentación casi lista.
- **Por qué Clío:** Musa de la historia: registra lo que pasa para que no se olvide.

### Asclepio · Soporte técnico nivel 3

- **Edad y antigüedad:** 40 años, 6 años en la empresa.
- **Trayectoria:** Empezó en soporte de nivel 1 en la propia Olimpia y fue subiendo. Aprendió SQL y a leer código por su cuenta.
- **Fortalezas:** Diagnostica problemas de clientes con una precisión asombrosa. Conoce los casos raros mejor que los propios desarrolladores. Calma a los clientes enfadados.
- **Carencias:** Aplica arreglos manuales en datos que deberían corregirse en el código. Le cuesta escalar a tiempo.
- **Fuera de su ámbito:** Forma a todos los nuevos de soporte. Conoce a muchos clientes por su nombre.
- **Cómo trabaja:** Registro detallado de cada incidencia. Llamadas con el cliente para ver el problema en directo.
- **Relaciones:** Néstor y él son el frente con los clientes. Argos usa sus casos para crear nuevos tests.
- **Por qué Asclepio:** Dios de la medicina, que curaba incluso lo que parecía incurable.

### Néstor · Customer Success Manager

- **Edad y antigüedad:** 55 años, 4 años en la empresa.
- **Trayectoria:** Treinta años vendiendo y acompañando a clientes de software de gestión. El veterano de la casa.
- **Fortalezas:** Relaciones de confianza con los clientes grandes. Sabe qué cliente está a punto de irse antes de que lo diga. Consejero sensato.
- **Carencias:** Cuenta muchas batallitas en las reuniones. Algo reacio a las herramientas nuevas de CRM.
- **Fuera de su ámbito:** Ha sido mentor informal de varios managers jóvenes. Conoce el sector de las pymes como nadie.
- **Cómo trabaja:** Visitas presenciales y llamadas largas. Notas en una libreta de papel.
- **Relaciones:** Hermes le escucha mucho. Lleva a Odiseo y a Afrodita a visitar clientes.
- **Por qué Néstor:** El anciano sabio de la guerra de Troya, cuyos consejos todos escuchaban. También contaba muchas historias.

## Dinámicas, tensiones y riesgos

El mayor riesgo del equipo es que el conocimiento crítico vive en tres cabezas: Hefesto, Ariadna y Temis. Si cualquiera de ellos se va, el módulo de facturación queda cojo durante meses.

**Alianzas que funcionan**

- **Odiseo y Temis:** juntos entienden al cliente y la ley mejor que nadie; el riesgo es que prometen más de lo que el equipo puede entregar.
- **Hestia y Penélope:** cuidan de las personas y del proceso, y son el freno a las prisas de Hermes.
- **Argos, Ariadna y Casandra:** el bloque de la calidad. Rara vez se les escapa nada, aunque a veces ralentizan.
- **Asclepio y Néstor:** traen la voz del cliente real a cada discusión.

**Tensiones abiertas**

- **Ícaro contra Argos:** velocidad frente a calidad. Es una tensión sana si Hestia la gestiona en vez de evitarla.
- **Narciso contra Afrodita y Apolo:** quién tiene la última palabra sobre lo visual. Iris hace de puente, pero no es su trabajo.
- **Hermes contra Atenea y Hestia:** las fechas que se prometen a clientes sin consultar a ingeniería.
- **Prometeo contra Casandra:** innovar rápido frente a no abrir agujeros de seguridad.
- **Hefesto contra Dédalo:** pragmatismo frente a elegancia arquitectónica. Discusiones largas que suelen acabar en mejores soluciones.

**Riesgos y lo que haría falta**

- **Dependencia de Hefesto:** debe delegar y preparar a Ariadna como posible sucesora.
- **Atlas saturado:** la plataforma necesita al menos un SRE más antes del próximo cierre fiscal.
- **Casandra ignorada:** hay que darle un canal directo con dirección y ayudarla a hablar en términos de riesgo de negocio.
- **Ícaro sin red:** necesita revisiones obligatorias en todo lo que toque dinero y un mentor fijo.
- **Temis no escala:** una sola experta fiscal para cinco equipos es un cuello de botella; conviene formar a Ariadna y a Odiseo o contratar a otra persona.

El equipo es bueno porque sus defectos se compensan entre sí: la prisa de Ícaro choca con los cien ojos de Argos, el perfeccionismo de Ariadna con el pragmatismo de Proteo. Funciona mientras Hestia mantenga el fuego encendido.
