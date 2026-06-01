/**
 * Real-Time Firestore Listeners Service
 * Provides real-time synchronization of data from Firestore
 * 
 * Usage:
 * - Subscribe to bank tie-up changes
 * - Subscribe to available banks changes
 * - Subscribe to lead updates
 */

import { getFirestore, collection, query, where, onSnapshot, getDocs } from "firebase/firestore";

/**
 * Subscribe to dealership's bank tie-ups (real-time)
 * 
 * @param {string} dealershipId - Dealership ID
 * @param {Function} callback - Called with updated tie-ups array
 * @returns {Function} Unsubscribe function
 */
export function subscribeToBankTieUps(dealershipId, callback) {
  const db = getFirestore();

  const unsubscribe = onSnapshot(
    query(
      collection(db, "dealerships"),
      where("id", "==", dealershipId)
    ),
    (querySnapshot) => {
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        callback({
          bankTieUps: data.bankTieUps || [],
          bankTieUpDates: data.bankTieUpDates || {},
          updatedAt: data.updatedAt,
        });
      });
    },
    (error) => {
      console.error("Error listening to bank tie-ups:", error);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to approved bank branches (real-time)
 * Dealerships see all approved + active banks
 * 
 * @param {Function} callback - Called with updated banks array
 * @returns {Function} Unsubscribe function
 */
export function subscribeToAvailableBanks(callback) {
  const db = getFirestore();

  const unsubscribe = onSnapshot(
    query(
      collection(db, "banks"),
      where("approved", "==", true),
      where("active", "==", true)
    ),
    (querySnapshot) => {
      const banks = [];
      querySnapshot.forEach((doc) => {
        banks.push({
          id: doc.id,
          bankId: doc.id,
          ...doc.data(),
        });
      });

      // Sort by bank name
      banks.sort((a, b) => a.bankName.localeCompare(b.bankName));
      callback(banks);
    },
    (error) => {
      console.error("Error listening to available banks:", error);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to lead changes
 * 
 * @param {string} leadId - Lead ID
 * @param {Function} callback - Called with updated lead data
 * @returns {Function} Unsubscribe function
 */
export function subscribeToLead(leadId, callback) {
  const db = getFirestore();

  const unsubscribe = onSnapshot(
    query(collection(db, "leads"), where("id", "==", leadId)),
    (querySnapshot) => {
      querySnapshot.forEach((doc) => {
        callback({
          id: doc.id,
          ...doc.data(),
        });
      });
    },
    (error) => {
      console.error("Error listening to lead:", error);
    }
  );

  return unsubscribe;
}

/**
 * Get bank details by IFSC code
 * 
 * @param {string} ifscCode - IFSC code
 * @returns {Promise<Object>} Bank details
 */
export async function getBankByIFSC(ifscCode) {
  const db = getFirestore();

  const querySnapshot = await getDocs(
    query(
      collection(db, "banks"),
      where("ifscCode", "==", ifscCode.toUpperCase()),
      where("approved", "==", true),
      where("active", "==", true)
    )
  );

  if (querySnapshot.empty) {
    throw new Error("Bank not found");
  }

  const doc = querySnapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data(),
  };
}

/**
 * Get all approved banks
 * 
 * @returns {Promise<Array>} Array of approved banks
 */
export async function getApprovedBanks() {
  const db = getFirestore();

  const querySnapshot = await getDocs(
    query(
      collection(db, "banks"),
      where("approved", "==", true),
      where("active", "==", true)
    )
  );

  const banks = [];
  querySnapshot.forEach((doc) => {
    banks.push({
      id: doc.id,
      ...doc.data(),
    });
  });

  return banks;
}

/**
 * Subscribe to all leads for a dealership
 * 
 * @param {string} dealershipId - Dealership ID
 * @param {Function} callback - Called with updated leads array
 * @returns {Function} Unsubscribe function
 */
export function subscribeToDealershipLeads(dealershipId, callback) {
  const db = getFirestore();

  const unsubscribe = onSnapshot(
    query(
      collection(db, "leads"),
      where("dealershipId", "==", dealershipId)
    ),
    (querySnapshot) => {
      const leads = [];
      querySnapshot.forEach((doc) => {
        leads.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Sort by creation date (newest first)
      leads.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
      callback(leads);
    },
    (error) => {
      console.error("Error listening to dealership leads:", error);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to notifications
 * 
 * @param {string} userId - User ID or email
 * @param {Function} callback - Called with updated notifications
 * @returns {Function} Unsubscribe function
 */
export function subscribeToNotifications(userId, callback) {
  const db = getFirestore();

  const unsubscribe = onSnapshot(
    query(
      collection(db, "notifications"),
      where("recipientId", "==", userId)
    ),
    (querySnapshot) => {
      const notifications = [];
      querySnapshot.forEach((doc) => {
        notifications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Sort by creation date (newest first)
      notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      callback(notifications);
    },
    (error) => {
      console.error("Error listening to notifications:", error);
    }
  );

  return unsubscribe;
}

/**
 * Combine multiple listeners
 * Useful for subscribing to multiple data streams
 * 
 * @param {Array} subscriptions - Array of subscription functions
 * @returns {Function} Function to unsubscribe from all
 */
export function combineSubscriptions(subscriptions) {
  return () => {
    subscriptions.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });
  };
}
