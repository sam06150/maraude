/* Données de démonstration — annuaire de ressources (Paris, exemples).
   À remplacer par les vraies données de ton association / territoire. */
window.SEED_RESSOURCES = [
  { id: "r1", nom: "Accueil de jour — La Halte", type: "Accueil de jour", adresse: "12 rue de l'Espoir, 75011 Paris", lat: 48.8566, lng: 2.3782, horaires: "Lun–Ven 9h–17h", tel: "01 40 00 00 01" },
  { id: "r2", nom: "Bains-douches municipaux", type: "Douches", adresse: "8 rue Oberkampf, 75011 Paris", lat: 48.8649, lng: 2.3712, horaires: "Mar–Dim 7h–19h", tel: "" },
  { id: "r3", nom: "Restaurant solidaire du Cœur", type: "Repas", adresse: "45 bd de Belleville, 75011 Paris", lat: 48.8687, lng: 2.3785, horaires: "Tous les jours 11h30–14h", tel: "01 40 00 00 02" },
  { id: "r4", nom: "Centre d'hébergement d'urgence", type: "Hébergement", adresse: "3 rue du Refuge, 75020 Paris", lat: 48.8632, lng: 2.3990, horaires: "24h/24 — sur orientation 115", tel: "115" },
  { id: "r5", nom: "Point d'eau potable — Square", type: "Point d'eau", adresse: "Square Maurice Gardette, 75011 Paris", lat: 48.8601, lng: 2.3789, horaires: "Accès libre", tel: "" },
  { id: "r6", nom: "Permanence médicale gratuite", type: "Santé", adresse: "22 rue de la Roquette, 75011 Paris", lat: 48.8549, lng: 2.3730, horaires: "Lun–Sam 10h–16h", tel: "01 40 00 00 03" },
  { id: "r7", nom: "Bagagerie solidaire", type: "Bagagerie", adresse: "5 rue Saint-Maur, 75011 Paris", lat: 48.8631, lng: 2.3760, horaires: "Lun–Ven 8h–20h", tel: "" }
];

window.RESSOURCE_TYPES = ["Accueil de jour", "Douches", "Repas", "Hébergement", "Point d'eau", "Santé", "Bagagerie", "Autre"];
window.BESOIN_TYPES = ["Couverture", "Repas", "Boisson chaude", "Kit hygiène", "Vêtements", "Écoute", "Médical", "Orientation 115"];
window.SECTEURS = ["Centre", "Nord", "Sud", "Est", "Ouest", "Gare"];

/* Partenaires / donateurs (suggestions pour le stock) */
window.PARTENAIRES = ["Banque alimentaire", "Boulangerie", "Supermarché", "Restaurant", "Croix-Rouge", "Restos du Cœur", "Particulier / don", "Collecte", "Association", "Autre"];

/* Tailles pour les articles de stock (vêtements + pointures) */
window.TAILLES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "Enfant", "Unique"];

/* Réseaux sociaux (fiche personne) */
window.RESEAUX_TYPES = ["TikTok", "Instagram", "Facebook", "Snapchat", "X (Twitter)", "WhatsApp", "YouTube", "Autre"];

/* Personnel de la maraude */
window.PERSONNEL_ROLES = ["Bénévole", "Chef d'équipe", "Coordinateur", "Chauffeur", "Infirmier·ère", "Travailleur social"];

/* Démarches types pour sortir de la rue (modèle pré-rempli) */
window.DEMARCHES_TYPES = [
  "Domiciliation administrative",
  "Papiers d'identité (CNI/passeport)",
  "Demande d'hébergement (SIAO / 115)",
  "Ouverture des droits (RSA)",
  "Couverture santé (AME / Complémentaire santé solidaire)",
  "Ouverture d'un compte bancaire",
  "Accompagnement social (référent)",
  "Inscription France Travail / emploi",
  "Suivi médical / addictologie",
  "Régularisation séjour (si besoin)",
];

/* Articles courants (autocomplétion) */
window.ARTICLES_COURANTS = [
  "Duvet / sac de couchage", "Couverture", "Tente", "Vêtements chauds", "Chaussures",
  "Sous-vêtements", "Kit hygiène", "Serviettes hygiéniques", "Nourriture", "Eau",
  "Croquettes animal", "Trousse de premiers soins", "Chargeur téléphone", "Masques",
];
