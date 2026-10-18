package com.scima.learning.ui.create

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.google.android.material.card.MaterialCardView
import com.scima.learning.R

class CreateFragment : Fragment() {
    
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_create, container, false)
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        // AI Capture option
        view.findViewById<MaterialCardView>(R.id.card_ai_capture).setOnClickListener {
            openAICapture()
        }
        
        // Manual card creation
        view.findViewById<MaterialCardView>(R.id.card_manual_create).setOnClickListener {
            openManualCreate()
        }
        
        // Import from file
        view.findViewById<MaterialCardView>(R.id.card_import).setOnClickListener {
            openImport()
        }
        
        // Create deck
        view.findViewById<MaterialCardView>(R.id.card_create_deck).setOnClickListener {
            openCreateDeck()
        }
    }
    
    private fun openAICapture() {
        // Navigate to AI capture screen
        parentFragmentManager.beginTransaction()
            .replace(R.id.container, AICaptureFragment())
            .addToBackStack(null)
            .commit()
    }
    
    private fun openManualCreate() {
        // Navigate to manual card creation
        parentFragmentManager.beginTransaction()
            .replace(R.id.container, ManualCardFragment())
            .addToBackStack(null)
            .commit()
    }
    
    private fun openImport() {
        // Open file picker for import
    }
    
    private fun openCreateDeck() {
        // Show dialog to create new deck
    }
}
