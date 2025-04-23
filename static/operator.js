"use strict";

// Definisci le variabili globali all'inizio del file, fuori da $(document).ready
let map;
let marker;
let currentUser;
let markers = [];

// Rendi la funzione editPerizia globale
window.editPerizia = async function(periziaId) {
    try {
        const response = await inviaRichiesta('GET', `/api/perizie/${periziaId}`);
        if(response.status === 200) {
            const perizia = response.data;
            
            // Create and show modal
            const modalHtml = `
                <div class="modal fade" id="editPeriziaModal">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Modifica Perizia</h5>
                                <button type="button" class="close" data-dismiss="modal">&times;</button>
                            </div>
                            <div class="modal-body">
                                <form id="editPeriziaForm">
                                    <div class="form-group">
                                        <label>Descrizione</label>
                                        <textarea class="form-control" id="editDescrizione">${perizia.descrizione}</textarea>
                                    </div>
                                    <div class="foto-container">
                                        ${perizia.foto ? perizia.foto.map((foto, index) => `
                                            <div class="foto-item mb-3">
                                                <img src="${foto.img}" class="img-fluid mb-2">
                                                <textarea class="form-control" 
                                                    placeholder="Commento foto">${foto.commento || ''}</textarea>
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-dismiss="modal">Annulla</button>
                                <button type="button" class="btn btn-primary" onclick="savePeriziaChanges('${perizia._id}')">
                                    Salva Modifiche
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Remove existing modal if present
            $('#editPeriziaModal').remove();
            
            // Add modal to body and show it
            $('body').append(modalHtml);
            $('#editPeriziaModal').modal('show');
        }
    } catch(error) {
        console.error("Error loading perizia:", error);
        alert('Errore nel caricamento della perizia');
    }
}

// Rendi anche savePeriziaChanges globale
window.savePeriziaChanges = async function(periziaId) {
    try {
        const updatedPerizia = {
            descrizione: $('#editDescrizione').val(),
            foto: Array.from($('.foto-item')).map(item => ({
                img: $(item).find('img').attr('src'),
                commento: $(item).find('textarea').val() || ''
            }))
        };

        const response = await inviaRichiesta('PUT', `/api/perizie/${periziaId}`, updatedPerizia);
        if(response.status === 200) {
            $('#editPeriziaModal').modal('hide');
            await loadOperatorPerizie(); // Ricarica le perizie
            alert('Perizia aggiornata con successo');
        }
    } catch(error) {
        console.error("Error updating perizia:", error);
        alert('Errore durante l\'aggiornamento della perizia');
    }
}

// Il resto del codice dentro $(document).ready rimane invariato
$(document).ready(function() {
    init();

    async function init() {
        console.log(currentUser)
        try {
            let response = await inviaRichiesta('GET', '/api/checkUser');
            
            if(response.status == 200) {
                currentUser = response.data;
                
                if(currentUser.username === 'Admin') {
                    window.location.href = 'index.html';
                    return;
                }

                $('#userInfo').text(`Benvenuto ${currentUser.username}`);
                initMap();
                await loadOperatorPerizie();
            }
        } catch(err) {
            console.error("Init error:", err);
            window.location.href = 'login.html';
        }
    }

    // Modifica la funzione initMap
    function initMap() {
        const center = [44.5557763, 7.7347183];
        map = L.map('map').setView(center, 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Crea un'icona personalizzata per la sede centrale
        const sedeIcon = L.divIcon({
            className: 'sede-marker',
            html: '<i class="fas fa-building"></i>',
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        });

        // Aggiungi il marker della sede con l'icona personalizzata e il popup
        L.marker(center, {
            icon: sedeIcon,
            title: 'Sede Centrale',
            zIndexOffset: 1000
        })
        .addTo(map)
        .bindPopup(`
            <div class="sede-popup">
                <h6><i class="fas fa-building mr-2"></i>IIS G. Vallauri</h6>
                <p class="mb-0">Sede Centrale - Fossano</p>
            </div>
        `);

        // Gestione click sulla mappa per nuove perizie
        map.on('click', function(e) {
            if(marker) {
                map.removeLayer(marker);
            }
            marker = L.marker(e.latlng).addTo(map);
            $('#lat').val(e.latlng.lat);
            $('#lng').val(e.latlng.lng);
            
            $('#coordinates').removeClass('d-none')
                           .find('span')
                           .text(`${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`);
        });
    }

    async function loadOperatorPerizie() {
        console.log("Loading operator perizie for user:", currentUser._id);
        try {
            const response = await inviaRichiesta('GET', `/api/perizie?operatore=${currentUser._id}`);
            console.log("Perizie response:", response.data); // Debug
            if (response.status === 200 && Array.isArray(response.data)) {
                clearMarkers();
                response.data.forEach(perizia => addPeriziaMarker(perizia));
            } else {
                console.error("Nessuna perizia trovata per l'operatore:", currentUser._id);
            }
        } catch (error) {
            console.error("Errore nel caricamento delle perizie:", error);
        }
    }

    function clearMarkers() {
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
    }

    function addPeriziaMarker(perizia) {
        if (!perizia.coordinate || !perizia.coordinate.latitude || !perizia.coordinate.longitude) {
            console.error("Coordinate non valide per la perizia:", perizia);
            return;
        }

        const marker = L.marker([
            perizia.coordinate.latitude,
            perizia.coordinate.longitude
        ]);

        const popupContent = `
            <div class="perizia-popup" style="max-width: 300px;">
                <h6 class="mb-3">Perizia del ${new Date(perizia["data-ora"]).toLocaleDateString()}</h6>
                <p class="mb-3"><strong>Descrizione:</strong> ${perizia.descrizione}</p>
                ${perizia.foto ? perizia.foto.map(foto => `
                    <div class="perizia-image mb-3">
                        <img src="${foto.img}" class="img-fluid mb-2" style="max-width: 100%; border-radius: 4px;">
                        <p class="small text-muted">${foto.commento || ''}</p>
                    </div>
                `).join('') : ''}
                <button class="btn btn-sm btn-primary w-100" 
                    onclick="window.editPerizia('${perizia._id}')">
                    <i class="fas fa-edit"></i> Modifica Perizia
                </button>
            </div>
        `;

        // Crea il popup e associalo al marker
        const popup = L.popup({
            maxWidth: 350,
            className: 'custom-popup'
        }).setContent(popupContent);

        marker.bindPopup(popup);
        
        // Aggiungi il marker alla mappa
        marker.addTo(map);
        
        // Aggiungi alla lista dei markers
        markers.push(marker);

        // Opzionale: apri il popup al click sul marker
        marker.on('click', function() {
            marker.openPopup();
        });
    }

    // Modifica la gestione del form di upload
    $('#foto').on('change', function(e) {
        const files = Array.from(e.target.files);
        $('#fotoPreview').empty();
        
        files.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                $('#fotoPreview').append(`
                    <div class="col-md-6 mb-3">
                        <div class="card">
                            <img src="${e.target.result}" class="card-img-top preview-img">
                            <div class="card-body">
                                <textarea class="form-control" placeholder="Commento foto" 
                                    id="comment${index}"></textarea>
                            </div>
                        </div>
                    </div>
                `);
            }
            reader.readAsDataURL(file);
        });
        
        $('.custom-file-label').text(
            files.length > 1 ? `${files.length} file selezionati` : files[0].name
        );
    });

    // Modifica l'invio del form
    $('#newPeriziaForm').on('submit', async function(e) {
        e.preventDefault();
        
        if(!$('#lat').val() || !$('#lng').val()) {
            alert('Seleziona una posizione sulla mappa');
            return;
        }

        const formData = new FormData();
        formData.append('descrizione', $('#descrizione').val());
        formData.append('latitude', $('#lat').val());
        formData.append('longitude', $('#lng').val());

        // Raccogli le foto e i commenti
        const foto = [];
        $('#fotoPreview .card').each(function() {
            foto.push({
                img: $(this).find('img').attr('src'),  // L'immagine in base64
                commento: $(this).find('textarea').val() || ''
            });
        });

        formData.append('foto', JSON.stringify(foto));

        try {
            const response = await inviaRichiesta('POST', '/api/perizie', formData);
            if(response.status === 200) {
                alert('Perizia salvata con successo');
                window.location.reload();
            }
        } catch(error) {
            console.error(error);
            alert('Errore durante il salvataggio della perizia');
        }
    });

    // Logout
    $('#btnLogout').on('click', async function() {
        try {
            await inviaRichiesta('POST', '/api/logout');
            window.location.href = 'login.html';
        } catch(error) {
            console.error(error);
        }
    });
});